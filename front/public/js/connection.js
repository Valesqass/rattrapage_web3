// Client MQTT over WebSocket : session persistante (clean=false) pour que le broker garde en file
// les messages pendant une coupure, reconnexion automatique, decodage des topics rc/v1/...

import mqtt from '../vendor/mqtt.esm.js';

export const ROOT = 'rc/v1';
const RECONNECT_MS = 2000;
const NOT_AUTHORIZED = new Set([4, 5, 134, 135]);

/** rc/v1/{zone}/{node}/{kind}[/{sensor}] | rc/v1/gw/{id}/status | rc/v1/alerts/{id}/ack */
export function parseTopic(topic) {
  const p = topic.split('/');
  if (p[0] !== 'rc' || p[1] !== 'v1') return null;
  if (p[2] === 'gw' && p[4] === 'status') return { kind: 'gateway', gwId: p[3] };
  if (p[2] === 'alerts' && p[4] === 'ack') return { kind: 'alert_ack', alertId: p[3] };
  if (p.length === 5) return { kind: p[4], zone: p[2], nodeId: p[3] };
  if (p.length === 6 && p[4] === 'reading') return { kind: 'reading', zone: p[2], nodeId: p[3], sensor: p[5] };
  return null;
}

/** Identifiant de client stable par navigateur : cle de la session persistante. */
export function stableClientId() {
  const KEY = 'rc.clientId';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = `rc-front-${randomHex(8)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `rc-front-${randomHex(8)}`;
  }
}

export function randomHex(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/**
 * @param {{url: string, username: string, password: string, clientId: string,
 *          onMessage: (t: object, payload: any, topic: string) => void,
 *          onState: (state: string, detail?: string) => void}} o
 */
export function connect(o) {
  const client = mqtt.connect(o.url, {
    clientId: o.clientId,
    username: o.username,
    password: o.password,
    clean: false,
    keepalive: 30,
    reconnectPeriod: RECONNECT_MS,
    connectTimeout: 8000,
    protocolVersion: 4,
  });

  o.onState('connecting');
  client.on('connect', (connack) => {
    o.onState('connected', connack.sessionPresent ? 'session reprise' : 'nouvelle session');
    if (!connack.sessionPresent) client.subscribe(`${ROOT}/#`, { qos: 1 });
  });
  client.on('reconnect', () => o.onState('reconnecting'));
  client.on('offline', () => o.onState('offline'));
  client.on('error', (err) => {
    if (NOT_AUTHORIZED.has(err?.code)) {
      o.onState('unauthorized', 'identifiants refusés par le broker');
      client.end(true);
      return;
    }
    o.onState('error', err?.message ?? String(err));
  });
  client.on('message', (topic, buf) => {
    const t = parseTopic(topic);
    if (!t || t.kind === 'cmd') return;
    let payload;
    try {
      payload = buf.length ? JSON.parse(new TextDecoder().decode(buf)) : null;
    } catch {
      console.warn('[mqtt] payload JSON invalide ignore', topic);
      return;
    }
    o.onMessage(t, payload, topic);
  });

  return {
    publish(topic, obj, { qos = 1, retain = false } = {}) {
      return new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(obj), { qos, retain }, (err) => (err ? reject(err) : resolve()));
      });
    },
    get connected() {
      return client.connected;
    },
    end() {
      client.end(true);
    },
  };
}
