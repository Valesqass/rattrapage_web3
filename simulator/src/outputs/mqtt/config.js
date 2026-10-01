'use strict';

// Configuration de l'adaptateur MQTT, exclusivement par variables d'environnement.
// Echoue au demarrage avec un message clair si une valeur obligatoire manque ou est invalide.

const DEFAULTS = {
  MQTT_TOPIC_ROOT: 'rc/v1',
  MQTT_GW_ID: 'sim',
  MQTT_KEEPALIVE_S: '30',
  MQTT_RECONNECT_MS: '2000',
  MQTT_BUFFER_MAX: '20000',
  MQTT_GW_STATUS_PERIOD_MS: '5000',
};

const REQUIRED = ['MQTT_URL', 'MQTT_NODE_SECRET', 'MQTT_GW_PASSWORD'];

function intFrom(env, key, min, max) {
  const raw = env[key] ?? DEFAULTS[key];
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${key}=${raw} invalide (entier attendu entre ${min} et ${max})`);
  }
  return v;
}

function loadMqttConfig(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`variables d'environnement manquantes : ${missing.join(', ')}`);
  if (!/^(mqtts?|wss?):\/\//.test(env.MQTT_URL)) throw new Error(`MQTT_URL invalide : ${env.MQTT_URL}`);

  const gwId = env.MQTT_GW_ID ?? DEFAULTS.MQTT_GW_ID;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(gwId)) throw new Error(`MQTT_GW_ID invalide : ${gwId}`);

  return Object.freeze({
    url: env.MQTT_URL,
    root: env.MQTT_TOPIC_ROOT ?? DEFAULTS.MQTT_TOPIC_ROOT,
    nodeSecret: env.MQTT_NODE_SECRET,
    gwId,
    gwPassword: env.MQTT_GW_PASSWORD,
    keepaliveS: intFrom(env, 'MQTT_KEEPALIVE_S', 5, 600),
    reconnectMs: intFrom(env, 'MQTT_RECONNECT_MS', 200, 60_000),
    bufferMax: intFrom(env, 'MQTT_BUFFER_MAX', 100, 1_000_000),
    gwStatusPeriodMs: intFrom(env, 'MQTT_GW_STATUS_PERIOD_MS', 500, 60_000),
  });
}

module.exports = { loadMqttConfig };
