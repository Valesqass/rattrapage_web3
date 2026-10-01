'use strict';

// Adaptateur de sortie "mqtt" (meme interface que outputs/console.js : start(sim) / stop()).
//
// - une connexion MQTT par node (clientId, identifiants et Last Will propres), plus une pour la
//   passerelle qui diffuse l'horloge de reference ;
// - chaque message est horodate par la passerelle (gwTs) AVANT mise en tampon ;
// - couche physique simulee : quand le simulateur considere un node eteint (pile vide, coupure
//   secteur, watchdog), sa connexion est coupee brutalement pour que le broker publie son Last Will.

const { MqttLink } = require('./link');
const P = require('./protocol');

const REACHABILITY_POLL_MS = 250;
const ACK_MEMORY = 200;
const STATE_LOG_DEBOUNCE_MS = 1000;

const defaultLog = (msg) => process.stderr.write(`[mqtt] ${msg}\n`);

function deviceIsUp(sim, n) {
  if (!n.online || n.offlineUntil) return false;
  const room = n.room ? sim.rooms.get(n.room) : null;
  return !(room?.powerCut && n.power === 'mains');
}

function createMqttOutput({ config, log = defaultLog }) {
  const links = new Map(); // nodeId -> MqttLink
  const pendingCmds = new Map(); // nodeId -> cmd[] recues pendant que le node etait injoignable
  const lastAcks = new Map(); // cmdId -> payload d'ack (idempotence)
  const timers = [];
  let gwLink = null;
  let sim = null;
  let stateLogTimer = null;

  const statusPayload = (online, reason) => JSON.stringify({ v: P.SCHEMA_VERSION, online, ...(reason ? { reason } : {}) });

  function logConnectionState() {
    clearTimeout(stateLogTimer);
    stateLogTimer = setTimeout(() => {
      const all = [...links.values(), gwLink];
      const up = all.filter((l) => l.connected).length;
      const alive = all.filter((l) => l.alive).length;
      log(`liaisons connectees ${up}/${alive} (${all.length - alive} device(s) eteint(s))`);
    }, STATE_LOG_DEBOUNCE_MS);
  }

  const reportedErrors = new Set();
  function onLinkState(event, link, detail) {
    if (event === 'connect') reportedErrors.delete(link.o.clientId);
    if (event === 'error' && !reportedErrors.has(link.o.clientId)) {
      reportedErrors.add(link.o.clientId);
      log(`${link.o.clientId} : ${detail?.message ?? detail}`);
    }
    if (event === 'flushed') log(`${link.o.clientId} : ${detail} message(s) du tampon reemis`);
    if (event === 'subscribe_error') log(`${link.o.clientId} : abonnement refuse (${detail?.message ?? detail})`);
    if (event === 'connect' || event === 'close') logConnectionState();
  }

  function publishEnvelope(node, payload) {
    const link = links.get(node.id);
    const delivery = P.DELIVERY[payload.type];
    if (!link || !delivery) return;
    link.publish(P.topicFor(config.root, node, payload), JSON.stringify(payload), delivery, P.CRITICAL_TYPES.has(payload.type));
  }

  function rememberAck(payload) {
    if (!payload.cmdId) return;
    lastAcks.set(payload.cmdId, payload);
    if (lastAcks.size > ACK_MEMORY) lastAcks.delete(lastAcks.keys().next().value);
  }

  function onSimMessage(msg) {
    const node = sim.nodes.get(msg.node);
    if (!node) return;
    const payload = P.toEnvelope(msg, sim.now);
    if (payload.type === 'ack') rememberAck(payload);
    publishEnvelope(node, payload);
  }

  // Ack produit par le firmware lui-meme (commande rejetee avant d'atteindre le modele).
  function localAck(node, cmdId, action, ok, detail, extra = {}) {
    const payload = { v: P.SCHEMA_VERSION, node: node.id, type: 'ack', ts: sim.now, gwTs: sim.now, seq: null, cmdId, action, ok, detail, ...extra };
    rememberAck(payload);
    publishEnvelope(node, payload);
  }

  function execute(node, cmd) {
    const previous = lastAcks.get(cmd.id);
    if (previous) {
      publishEnvelope(node, { ...previous, gwTs: sim.now, duplicate: true });
      return;
    }
    if (cmd.exp !== null && sim.now > cmd.exp) {
      localAck(node, cmd.id, cmd.action, false, 'expired');
      return;
    }
    const res = sim.handleCommand({ id: cmd.id, target: node.id, action: cmd.action, value: cmd.value });
    if (res === null) {
      const list = pendingCmds.get(node.id) ?? [];
      pendingCmds.set(node.id, [...list, cmd]);
    }
  }

  function onCommand(node, raw) {
    const parsed = P.parseCommand(raw.toString('utf8'));
    if (!parsed.ok) {
      log(`commande rejetee pour ${node.id} : ${parsed.reason}`);
      if (parsed.id) localAck(node, parsed.id, null, false, 'bad_request', { reason: parsed.reason });
      return;
    }
    execute(node, parsed.cmd);
  }

  function makeNodeLink(node) {
    const base = P.nodeBase(config.root, node);
    return new MqttLink({
      url: config.url,
      clientId: `rc-node-${node.id}`,
      username: node.id,
      password: P.nodePassword(config.nodeSecret, node.id),
      will: { topic: `${base}/status`, payload: statusPayload(false, 'lwt'), qos: 1, retain: true },
      birth: () => ({ topic: `${base}/status`, payload: statusPayload(true) }),
      subscriptions: [`${base}/cmd`],
      keepaliveS: config.keepaliveS,
      reconnectMs: config.reconnectMs,
      bufferMax: config.bufferMax,
      onMessage: (_topic, payload) => onCommand(node, payload),
      onState: onLinkState,
    });
  }

  function makeGatewayLink() {
    const topic = `${config.root}/gw/${config.gwId}/status`;
    return new MqttLink({
      url: config.url,
      clientId: `rc-gw-${config.gwId}`,
      username: `gw-${config.gwId}`,
      password: config.gwPassword,
      will: { topic, payload: statusPayload(false, 'lwt'), qos: 1, retain: true },
      birth: () => ({ topic, payload: gatewayStatus() }),
      keepaliveS: config.keepaliveS,
      reconnectMs: config.reconnectMs,
      bufferMax: 100,
      onState: onLinkState,
    });
  }

  function gatewayStatus() {
    return JSON.stringify({ v: P.SCHEMA_VERSION, online: true, gwTs: sim.now, speed: sim.speed, scenario: sim.scenario.name });
  }

  function publishGatewayStatus() {
    if (!gwLink.connected) return; // horloge : une valeur perimee n'a aucun interet en tampon
    gwLink.publish(`${config.root}/gw/${config.gwId}/status`, gatewayStatus(), { qos: 1, retain: true }, false);
  }

  function syncReachability() {
    for (const [id, link] of links) {
      const node = sim.nodes.get(id);
      const up = deviceIsUp(sim, node);
      if (up && !link.alive) {
        link.connect();
        const queued = pendingCmds.get(id) ?? [];
        pendingCmds.delete(id);
        queued.forEach((cmd) => execute(node, cmd));
      } else if (!up && link.alive) {
        link.kill();
        logConnectionState();
      }
    }
  }

  return {
    start(s) {
      sim = s;
      for (const node of sim.nodes.values()) links.set(node.id, makeNodeLink(node));
      gwLink = makeGatewayLink();
      gwLink.connect();
      sim.on('message', onSimMessage);
      syncReachability();
      timers.push(setInterval(syncReachability, REACHABILITY_POLL_MS));
      timers.push(setInterval(publishGatewayStatus, config.gwStatusPeriodMs));
      log(`${links.size} nodes + passerelle "${config.gwId}" -> ${config.url} (racine ${config.root})`);
    },

    async stop() {
      timers.forEach(clearInterval);
      clearTimeout(stateLogTimer);
      sim?.off('message', onSimMessage);
      const farewell = (topic) => ({ topic, payload: statusPayload(false, 'shutdown') });
      const closing = [...links.values()].map((l) => {
        const node = sim.nodes.get(l.o.username);
        return l.close(farewell(`${P.nodeBase(config.root, node)}/status`));
      });
      closing.push(gwLink?.close(farewell(`${config.root}/gw/${config.gwId}/status`)));
      await Promise.all(closing);
    },
  };
}

module.exports = { createMqttOutput, deviceIsUp };
