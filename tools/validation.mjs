// Partie F : rejoue le scenario "incidents" a travers le moteur d'alertes du front et imprime
// chaque alerte (heure simulee de debut, heure de detection, delai) en Markdown.
// Usage : TZ=Europe/Paris node tools/validation.mjs [heures]

import { replay } from '../front/test/replay.js';

const hours = Number(process.argv[2] ?? 20);
const { engine } = replay({ hours });

const fmt = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const dur = (a, b) => `${Math.round((b - a) / 60000)} min`;

const rows = [...engine.alerts].reverse().filter((a) => a.rule !== 'node_boot');
console.log('| Début | Détection | Délai | Sévérité | Node | Alerte | Détail | Fin |');
console.log('|---|---|---|---|---|---|---|---|');
for (const a of rows) {
  console.log(`| ${fmt(a.startedAt)} | ${fmt(a.detectedAt)} | ${dur(a.startedAt, a.detectedAt)} | ${a.severity} | ${a.node ?? a.zone} | ${a.title} | ${a.detail} | ${a.endedAt ? fmt(a.endedAt) : 'active'} |`);
}
console.log(`\n${rows.length} alertes, ${engine.alerts.filter((a) => a.rule === 'node_boot').length} redémarrages.`);
