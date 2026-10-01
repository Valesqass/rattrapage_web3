'use strict';

const readline = require('node:readline');

// Adaptateur de sortie "console".
// Interface commune a tous les adaptateurs :
//   start(sim)  : branche l'adaptateur sur le simulateur
//   stop()      : ferme proprement
// Les messages sortants arrivent via sim.on('message', ...).
// Les commandes entrantes doivent etre passees a sim.handleCommand(cmd).

function createConsoleOutput({ format = 'pretty' } = {}) {
  let rl = null;

  const pretty = (m) => {
    const t = new Date(m.ts).toISOString().replace('T', ' ').slice(0, 19);
    switch (m.type) {
      case 'reading':
        return `${t}  ${m.node.padEnd(14)} ${m.sensor.padEnd(13)} ${String(m.value).padStart(8)} ${m.unit}`;
      case 'door':
        return `${t}  ${m.node.padEnd(14)} DOOR          ${m.state.toUpperCase()}`;
      case 'heartbeat':
        return `${t}  ${m.node.padEnd(14)} heartbeat     up=${m.uptimeS}s rssi=${m.rssi}${m.battery !== undefined ? ` batt=${m.battery}%` : ''}`;
      case 'boot':
        return `${t}  ${m.node.padEnd(14)} BOOT          reason=${m.reason}`;
      case 'ack':
        return `${t}  ${m.node.padEnd(14)} ACK           ${m.action} ok=${m.ok} ${m.detail}`;
      default:
        return JSON.stringify(m);
    }
  };

  return {
    start(sim) {
      sim.on('message', (m) => {
        process.stdout.write((format === 'json' ? JSON.stringify(m) : pretty(m)) + '\n');
      });

      // Commandes au format JSON sur stdin, une par ligne. Exemple :
      // {"id":"c1","target":"N-TRO-05","action":"safety_cut","value":true}
      rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        if (line.trim() === 'snapshot') {
          process.stderr.write(JSON.stringify(sim.snapshot(), null, 2) + '\n');
          return;
        }
        try {
          const res = sim.handleCommand(JSON.parse(line));
          if (res === null) process.stderr.write('! commande ignoree (node inconnu ou hors ligne)\n');
        } catch (err) {
          process.stderr.write(`! JSON invalide : ${err.message}\n`);
        }
      });
    },
    stop() {
      rl?.close();
    },
  };
}

module.exports = { createConsoleOutput };
