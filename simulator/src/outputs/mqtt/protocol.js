'use strict';

// Traduction messages simulateur <-> protocole MQTT v1 (voir docs/protocole.md).

const { createHash } = require('node:crypto');

const SCHEMA_VERSION = 1;
const ALLOWED_ACTIONS = new Set(['lamp', 'light', 'setpoint', 'safety_cut', 'interval', 'reboot', 'identify']);
const MAX_CMD_ID_LENGTH = 64;

// QoS / retain par type de message (docs/protocole.md §3)
const DELIVERY = {
  reading: { qos: 1, retain: true },
  door: { qos: 1, retain: true },
  heartbeat: { qos: 1, retain: true },
  boot: { qos: 1, retain: false },
  ack: { qos: 1, retain: false },
  status: { qos: 1, retain: true },
};

// Messages jamais sacrifies quand le tampon de coupure est plein.
const CRITICAL_TYPES = new Set(['door', 'boot', 'ack', 'status']);

function zoneOf(node) {
  return node.room ?? 'BLD';
}

function nodeBase(root, node) {
  return `${root}/${zoneOf(node)}/${node.id}`;
}

function topicFor(root, node, msg) {
  const base = nodeBase(root, node);
  return msg.type === 'reading' ? `${base}/reading/${msg.sensor}` : `${base}/${msg.type}`;
}

/** Message simulateur -> payload v1, horodate par la passerelle (gwTs). */
function toEnvelope(msg, gwTs) {
  const { node, type, ts, seq, ...rest } = msg;
  return { v: SCHEMA_VERSION, node, type, ts, gwTs, seq, ...rest };
}

/**
 * Valide une commande recue du broker.
 * @returns {{ ok: true, cmd: object } | { ok: false, id: string | null, reason: string }}
 */
function parseCommand(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, id: null, reason: 'invalid_json' };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, id: null, reason: 'not_an_object' };
  }
  const id = typeof data.id === 'string' && data.id.length > 0 && data.id.length <= MAX_CMD_ID_LENGTH ? data.id : null;
  if (!id) return { ok: false, id: null, reason: 'missing_id' };
  if (data.v !== SCHEMA_VERSION) return { ok: false, id, reason: 'unsupported_version' };
  if (!ALLOWED_ACTIONS.has(data.action)) return { ok: false, id, reason: 'unknown_action' };
  if (data.exp !== undefined && !Number.isFinite(data.exp)) return { ok: false, id, reason: 'bad_exp' };
  return { ok: true, cmd: { id, action: data.action, value: data.value, exp: data.exp ?? null } };
}

/** Mot de passe derive par node : le secret maitre ne quitte pas la passerelle. */
function nodePassword(secret, nodeId) {
  return createHash('sha256').update(`${secret}:${nodeId}`).digest('hex').slice(0, 24);
}

module.exports = {
  SCHEMA_VERSION,
  DELIVERY,
  CRITICAL_TYPES,
  zoneOf,
  nodeBase,
  topicFor,
  toEnvelope,
  parseCommand,
  nodePassword,
};
