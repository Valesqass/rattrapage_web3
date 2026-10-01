// Tests du moteur d'alertes : regles unitaires + rejeu complet du scenario "incidents".
// Lancer avec TZ=Europe/Paris (heure locale du site, comme dans le conteneur du simulateur).

import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../public/js/engine.js';
import { aberration, expectedRange, classify } from '../public/js/rules.js';
import { NODE_BY_ID } from '../public/js/site.js';
import { replay } from './replay.js';

const T0 = Date.parse('2026-10-01T10:00:00+02:00');
const reading = (nodeId, sensor, value, gwTs, seq) => ({
  kind: 'reading', nodeId, sensor,
  payload: { v: 1, node: nodeId, type: 'reading', ts: gwTs, gwTs, seq, sensor, value, unit: 'C' },
});

test('aberration reconnait les codes DS18B20 et les sauts impossibles', () => {
  assert.equal(aberration('temp_hot', -127, T0).reason, 'disconnected');
  assert.equal(aberration('temp_hot', 85, T0).reason, 'por');
  assert.equal(aberration('temp_hot', 30, T0 + 30_000, { value: 22, gwTs: T0 }).reason, 'jump');
  assert.equal(aberration('temp_hot', 30, T0 + 30_000, { value: 29, gwTs: T0 }), null);
  assert.equal(aberration('light', 150000, T0).reason, 'range');
});

test('expectedRange applique les seuils de l espece le jour et resserre le bac hospitalier', () => {
  const pogona = expectedRange(NODE_BY_ID.get('N-DES-01'), 'temp_hot', 12);
  assert.deepEqual(pogona.warn, [35, 43]);
  const hospital = expectedRange(NODE_BY_ID.get('N-SOI-01'), 'temp_hot', 12);
  assert.deepEqual(hospital.warn, [26.5, 30.5]);
  assert.equal(classify(44, pogona).level, 'warning');
  assert.equal(classify(47, pogona).level, 'critical');
});

test('une seule lecture hors plage ne declenche pas d alerte (anti-rebond)', () => {
  const e = new AlertEngine();
  e.ingest(reading('N-DES-01', 'temp_hot', 47, T0, 1));
  assert.equal(e.active.size, 0);
  e.ingest(reading('N-DES-01', 'temp_hot', 47.2, T0 + 30_000, 2));
  assert.equal([...e.active.values()][0].severity, 'critical');
});

test('un doublon QoS 1 (meme seq) est ignore', () => {
  const e = new AlertEngine();
  assert.equal(e.ingest(reading('N-DES-01', 'temp_hot', 40, T0, 7)), true);
  assert.equal(e.ingest(reading('N-DES-01', 'temp_hot', 40, T0, 7)), false);
});

test('un message de version inconnue est ignore', () => {
  const e = new AlertEngine();
  const m = reading('N-DES-01', 'temp_hot', 40, T0, 1);
  assert.equal(e.ingest({ ...m, payload: { ...m.payload, v: 2 } }), false);
});

test('ouverture de porte la nuit : alerte critique immediate', () => {
  const e = new AlertEngine();
  const night = Date.parse('2026-10-02T02:37:00+02:00');
  e.ingest({ kind: 'door', nodeId: 'N-DOOR-FEED', payload: { v: 1, node: 'N-DOOR-FEED', type: 'door', ts: night, gwTs: night, seq: 1, state: 'open' } });
  const a = [...e.active.values()].find((x) => x.rule === 'door_offhours');
  assert.equal(a?.severity, 'critical');
});

test("l'acquittement d'une alerte est conserve meme s'il arrive avant l'alerte", () => {
  const e = new AlertEngine();
  const night = Date.parse('2026-10-02T02:37:00+02:00');
  e.applyAck(`door_offhours~N-DOOR-FEED~-~${night}`, { by: 'rc-front-x', at: night });
  e.ingest({ kind: 'door', nodeId: 'N-DOOR-FEED', payload: { v: 1, node: 'N-DOOR-FEED', type: 'door', ts: night, gwTs: night, seq: 1, state: 'open' } });
  assert.equal(e.alerts[0].ack?.by, 'rc-front-x');
});

test('scenario incidents : chaque incident injecte est detecte', () => {
  const { engine } = replay({ hours: 20 });
  const found = (rule, node, sensor) => engine.alerts.find((a) => a.rule === rule && a.node === node && (!sensor || a.sensor === sensor));
  const minutesAfterStart = (a) => Math.round((a.detectedAt - Date.parse('2026-10-01T07:45:00')) / 60000);

  assert.ok(found('door_open_long', 'N-DES-02'), 'porte DES-02 mal refermee');
  assert.ok(found('sensor_fault', 'N-TRO-03', 'temp_hot'), 'sonde TRO-03 debranchee');
  assert.ok(found('light_anomaly', 'N-DES-04'), 'lampe DES-04 HS');
  assert.ok(found('threshold', 'N-TRO-05', 'temp_hot'), 'thermostat TRO-05 bloque');
  assert.ok(found('node_offline', 'N-QUA-03'), 'QUA-03 hors ligne');
  assert.ok(found('sensor_fault', 'N-SOI-02', 'temp_cold'), 'reset sonde SOI-02');
  assert.ok(engine.alerts.find((a) => a.rule === 'zone_down' && a.zone === 'QUA'), 'coupure QUA');
  assert.ok(found('clock_drift', 'N-TRO-06'), 'derive horloge TRO-06');
  assert.ok(found('battery_low', 'N-EXT-02'), 'pile EXT-02');
  assert.ok(found('door_offhours', 'N-DOOR-FEED'), 'intrusion nocturne');

  assert.ok(minutesAfterStart(found('sensor_fault', 'N-TRO-03', 'temp_hot')) <= 41, 'sonde detectee en moins d une minute');
});

test('scenario incidents : la porte fermee pendant la coupure QUA est resynchronisee au boot', () => {
  const { engine } = replay({ hours: 4 });
  const doorQua = engine.alerts.filter((a) => a.rule === 'door_open_long' && a.zone === 'QUA');
  assert.ok(doorQua.every((a) => !a.active));
});
