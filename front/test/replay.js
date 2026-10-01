// Rejoue le simulateur en memoire (sans broker) a travers le moteur d'alertes du front.
// Les messages sont traduits exactement comme le fait l'adaptateur MQTT (toEnvelope + gwTs).

import { createRequire } from 'node:module';
import { AlertEngine } from '../public/js/engine.js';

// Le simulateur planifie la journee en heure locale : on fixe le fuseau du site pour la reproductibilite.
process.env.TZ = 'Europe/Paris';

const require = createRequire(import.meta.url);
const { Simulator } = require('../../simulator/src/simulator.js');
const { toEnvelope } = require('../../simulator/src/outputs/mqtt/protocol.js');
const { deviceIsUp, bootDoorMessage } = require('../../simulator/src/outputs/mqtt/index.js');

const STEP_S = 60; // un tick du simulateur en vitesse 60

/**
 * @param {{scenario?: string, start?: string, hours: number}} opts
 * @returns {{engine: AlertEngine, sim: object}}
 */
export function replay({ scenario = 'incidents', start = '2026-10-01T07:45:00', hours }) {
  const sim = new Simulator({ seed: 42, speed: 60, scenario, start: Date.parse(start) });
  const engine = new AlertEngine();
  const up = new Map();

  const forward = (msg) => engine.ingest({ kind: msg.type, nodeId: msg.node, sensor: msg.sensor, payload: toEnvelope(msg, sim.now) });
  sim.on('message', (msg) => {
    forward(msg);
    if (msg.type === 'boot') forward(bootDoorMessage(sim, sim.nodes.get(msg.node), msg));
  });
  // Couche physique de l'adaptateur : un device eteint declenche son Last Will.
  const syncStatus = () => {
    for (const n of sim.nodes.values()) {
      const isUp = deviceIsUp(sim, n);
      if (up.get(n.id) === isUp) continue;
      up.set(n.id, isUp);
      engine.ingest({ kind: 'status', nodeId: n.id, payload: { v: 1, online: isUp, ...(isUp ? {} : { reason: 'lwt' }) } });
    }
  };

  syncStatus();
  sim.emitAllBoots();
  const steps = Math.round((hours * 3600) / STEP_S);
  for (let i = 0; i < steps; i++) {
    sim.advance(STEP_S);
    syncStatus();
    engine.tick(sim.now);
  }
  return { engine, sim };
}
