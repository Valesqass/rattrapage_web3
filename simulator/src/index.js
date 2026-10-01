#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const { Simulator } = require('./simulator');
const { createConsoleOutput } = require('./outputs/console');

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '42' },
    speed: { type: 'string', default: '60' },
    scenario: { type: 'string', default: 'incidents' },
    output: { type: 'string', default: 'console' },
    format: { type: 'string', default: 'pretty' },
    start: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage : node src/index.js [options]
  --seed <n>          graine aleatoire (defaut 42)
  --speed <n>         acceleration du temps (defaut 60 : 1 s reelle = 1 min simulee)
  --scenario <nom>    normal | incidents | chaos (defaut incidents)
  --output <nom>      console (defaut). A vous d'ajouter "mqtt".
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
};

if (!outputs[values.output]) {
  console.error(`Sortie inconnue : ${values.output}`);
  process.exit(1);
}

const out = outputs[values.output]();
out.start(sim);
sim.start(1000);

const shutdown = () => {
  sim.stop();
  out.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
