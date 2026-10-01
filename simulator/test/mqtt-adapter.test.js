'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/outputs/mqtt/protocol');
const { OutageBuffer } = require('../src/outputs/mqtt/outage-buffer');
const { loadMqttConfig } = require('../src/outputs/mqtt/config');
const { deviceIsUp } = require('../src/outputs/mqtt');

const ROOT = 'rc/v1';

test('topicFor place la zone avant le node et un topic par capteur', () => {
  const node = { id: 'N-DES-01', room: 'DES' };
  assert.equal(P.topicFor(ROOT, node, { type: 'reading', sensor: 'temp_hot' }), 'rc/v1/DES/N-DES-01/reading/temp_hot');
  assert.equal(P.topicFor(ROOT, node, { type: 'door' }), 'rc/v1/DES/N-DES-01/door');
});

test('les portes de batiment sont rangees dans la zone BLD', () => {
  assert.equal(P.topicFor(ROOT, { id: 'N-DOOR-FEED' }, { type: 'door' }), 'rc/v1/BLD/N-DOOR-FEED/door');
});

test("toEnvelope ajoute la version et l'horodatage passerelle sans perdre l'horodatage device", () => {
  const env = P.toEnvelope({ node: 'N-TRO-06', ts: 1000, seq: 7, type: 'reading', sensor: 'light', value: 3, unit: 'lx' }, 5000);
  assert.deepEqual(env, { v: 1, node: 'N-TRO-06', type: 'reading', ts: 1000, gwTs: 5000, seq: 7, sensor: 'light', value: 3, unit: 'lx' });
});

test('parseCommand accepte une commande valide', () => {
  const r = P.parseCommand(JSON.stringify({ v: 1, id: 'c1', action: 'lamp', value: 'off', exp: 99 }));
  assert.deepEqual(r, { ok: true, cmd: { id: 'c1', action: 'lamp', value: 'off', exp: 99 } });
});

test('parseCommand rejette JSON invalide, version inconnue et action inconnue', () => {
  assert.deepEqual(P.parseCommand('{oops'), { ok: false, id: null, reason: 'invalid_json' });
  assert.equal(P.parseCommand(JSON.stringify({ v: 2, id: 'c', action: 'lamp' })).reason, 'unsupported_version');
  assert.equal(P.parseCommand(JSON.stringify({ v: 1, id: 'c', action: 'format_disk' })).reason, 'unknown_action');
  assert.equal(P.parseCommand(JSON.stringify({ v: 1, action: 'lamp' })).reason, 'missing_id');
  assert.equal(P.parseCommand('[]').reason, 'not_an_object');
});

test('nodePassword est deterministe et propre a chaque node', () => {
  assert.equal(P.nodePassword('s', 'N-DES-01'), P.nodePassword('s', 'N-DES-01'));
  assert.notEqual(P.nodePassword('s', 'N-DES-01'), P.nodePassword('s', 'N-DES-02'));
  assert.match(P.nodePassword('s', 'N-DES-01'), /^[0-9a-f]{24}$/);
});

test('OutageBuffer sacrifie les mesures les plus anciennes et garde les evenements critiques', () => {
  const b = new OutageBuffer(3);
  b.push({ topic: 'door1' }, true);
  b.push({ topic: 'r1' }, false);
  b.push({ topic: 'r2' }, false);
  b.push({ topic: 'door2' }, true);
  assert.deepEqual(b.drain().map((i) => i.topic), ['door1', 'r2', 'door2']);
  assert.equal(b.dropped, 1);
  assert.equal(b.size, 0);
});

test('OutageBuffer conserve les critiques au-dela de la borne nominale', () => {
  const b = new OutageBuffer(2);
  for (let i = 0; i < 5; i++) b.push({ topic: `d${i}` }, true);
  assert.equal(b.size, 5);
});

test('loadMqttConfig exige les secrets et valide les entiers', () => {
  assert.throws(() => loadMqttConfig({}), /MQTT_URL, MQTT_NODE_SECRET, MQTT_GW_PASSWORD/);
  const base = { MQTT_URL: 'mqtt://broker:1883', MQTT_NODE_SECRET: 's', MQTT_GW_PASSWORD: 'p' };
  assert.equal(loadMqttConfig(base).keepaliveS, 30);
  assert.throws(() => loadMqttConfig({ ...base, MQTT_KEEPALIVE_S: 'abc' }), /MQTT_KEEPALIVE_S/);
  assert.throws(() => loadMqttConfig({ ...base, MQTT_URL: 'http://x' }), /MQTT_URL invalide/);
});

test('deviceIsUp reflete pile vide, watchdog et coupure secteur', () => {
  const sim = { rooms: new Map([['QUA', { powerCut: true }], ['DES', { powerCut: false }]]) };
  assert.equal(deviceIsUp(sim, { online: true, offlineUntil: null, room: 'DES', power: 'mains' }), true);
  assert.equal(deviceIsUp(sim, { online: true, offlineUntil: null, room: 'QUA', power: 'mains' }), false);
  assert.equal(deviceIsUp(sim, { online: false, offlineUntil: null, room: 'DES', power: 'battery' }), false);
  assert.equal(deviceIsUp(sim, { online: true, offlineUntil: 123, room: 'DES', power: 'mains' }), false);
});
