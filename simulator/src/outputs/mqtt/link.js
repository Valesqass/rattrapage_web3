'use strict';

// Une connexion MQTT = un device (node ou passerelle) : clientId, identifiants, Last Will et
// tampon de coupure propres. Reconnexion automatique geree par mqtt.js (reconnectPeriod).

const mqtt = require('mqtt');
const { OutageBuffer } = require('./outage-buffer');

class MqttLink {
  /**
   * @param {object} o
   * @param {string} o.url
   * @param {string} o.clientId
   * @param {string} o.username
   * @param {string} o.password
   * @param {{topic: string, payload: string, qos: 0|1|2, retain: boolean}} o.will
   * @param {() => {topic: string, payload: string}} [o.birth]  publie (retenu) a chaque connexion
   * @param {string[]} [o.subscriptions]
   * @param {number} o.keepaliveS
   * @param {number} o.reconnectMs
   * @param {number} o.bufferMax
   * @param {(topic: string, payload: Buffer) => void} [o.onMessage]
   * @param {(event: string, link: MqttLink, detail?: unknown) => void} [o.onState]
   */
  constructor(o) {
    this.o = o;
    this.buffer = new OutageBuffer(o.bufferMax);
    this.client = null;
  }

  get connected() {
    return Boolean(this.client?.connected);
  }

  get alive() {
    return this.client !== null;
  }

  connect() {
    if (this.client) return;
    const { o } = this;
    const client = mqtt.connect(o.url, {
      clientId: o.clientId,
      username: o.username,
      password: o.password,
      clean: false,
      keepalive: o.keepaliveS,
      reconnectPeriod: o.reconnectMs,
      connectTimeout: 10_000,
      will: { ...o.will, payload: Buffer.from(o.will.payload) },
    });
    this.client = client;

    client.on('connect', (connack) => {
      if (o.subscriptions?.length && !connack.sessionPresent) {
        client.subscribe(o.subscriptions, { qos: 1 }, (err) => {
          if (err) o.onState?.('subscribe_error', this, err);
        });
      }
      if (o.birth) {
        const b = o.birth();
        client.publish(b.topic, b.payload, { qos: 1, retain: true });
      }
      this.#flush();
      o.onState?.('connect', this);
    });
    client.on('close', () => o.onState?.('close', this));
    client.on('error', (err) => o.onState?.('error', this, err));
    client.on('message', (topic, payload) => o.onMessage?.(topic, payload));
  }

  publish(topic, payload, { qos, retain }, critical) {
    if (this.connected) {
      this.client.publish(topic, payload, { qos, retain });
      return;
    }
    this.buffer.push({ topic, payload, qos, retain }, critical);
  }

  #flush() {
    const items = this.buffer.drain();
    for (const it of items) {
      this.client.publish(it.topic, it.payload, { qos: it.qos, retain: it.retain });
    }
    if (items.length) this.o.onState?.('flushed', this, items.length);
  }

  /**
   * Coupure brutale (perte d'alimentation du device) : pas de DISCONNECT, le broker
   * publie donc le Last Will.
   */
  kill() {
    if (!this.client) return;
    this.client.end(true);
    this.client = null;
  }

  /** Fermeture propre : publie `farewell` (retenu) puis DISCONNECT. */
  close(farewell) {
    return new Promise((resolve) => {
      const client = this.client;
      if (!client) return resolve();
      this.client = null;
      const end = () => client.end(false, {}, () => resolve());
      if (farewell && client.connected) {
        client.publish(farewell.topic, farewell.payload, { qos: 1, retain: true }, end);
      } else {
        end();
      }
    });
  }
}

module.exports = { MqttLink };
