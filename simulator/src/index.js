#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const { Simulator } = require('./simulator');
const { createConsoleOutput } = require('./outputs/console');

// Chaque option peut aussi venir de l'environnement (SIM_*), la ligne de commande l'emporte.
const env = process.env;
const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: env.SIM_SEED ?? '42' },
    speed: { type: 'string', default: env.SIM_SPEED ?? '60' },
    scenario: { type: 'string', default: env.SIM_SCENARIO ?? 'incidents' },
    output: { type: 'string', default: env.SIM_OUTPUT ?? 'console' },
    format: { type: 'string', default: env.SIM_FORMAT ?? 'pretty' },
    start: { type: 'string', ...(env.SIM_START ? { default: env.SIM_START } : {}) },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage : node src/index.js [options]
  --seed <n>          graine aleatoire (defaut 42)
  --speed <n>         acceleration du temps (defaut 60 : 1 s reelle = 1 min simulee)
  --scenario <nom>    normal | incidents | chaos (defaut incidents)
  --output <noms>     console (defaut), mqtt, ou plusieurs separes par une virgule : console,mqtt
                      (mqtt : configuration par variables MQTT_*, voir README)
  --format <f>        pretty | json (sortie console)
  --start <iso>       date/heure de depart simulee (defaut : aujourd'hui 07:45)`);
  process.exit(0);
}

const sim = new Simulator({
  seed: Number(values.seed),
  speed: Number(values.speed),
  scenario: values.scenario,
  start: values.start ? Date.parse(values.start) : undefined,
});

const outputs = {
  console: () => createConsoleOutput({ format: values.format }),
  mqtt: () => {
    const { createMqttOutput } = require('./outputs/mqtt');
    const { loadMqttConfig } = require('./outputs/mqtt/config');
    return createMqttOutput({ config: loadMqttConfig() });
  },
};

const names = values.output.split(',').map((s) => s.trim()).filter(Boolean);
const unknown = names.filter((n) => !outputs[n]);
if (!names.length || unknown.length) {
  console.error(`Sortie inconnue : ${unknown.join(', ') || '(vide)'}`);
  process.exit(1);
}

let outs;
try {
  outs = names.map((n) => outputs[n]());
} catch (err) {
  console.error(`Configuration invalide : ${err.message}`);
  process.exit(1);
}
outs.forEach((o) => o.start(sim));
sim.start(1000);

const SHUTDOWN_TIMEOUT_MS = 3000;
const shutdown = async () => {
  sim.stop();
  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS));
  await Promise.race([Promise.allSettled(outs.map((o) => o.stop())), timeout]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
