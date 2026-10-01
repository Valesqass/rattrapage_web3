// Copie les bibliotheques navigateur (mqtt.js, uPlot, polices) dans public/vendor.
// Aucun CDN : le front fonctionne sur un reseau local isole.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

const FILES = [
  ['mqtt/dist/mqtt.esm.js', 'mqtt.esm.js'],
  ['uplot/dist/uPlot.esm.js', 'uPlot.esm.js'],
  ['uplot/dist/uPlot.min.css', 'uPlot.min.css'],
];
const FONTS = [
  ['@fontsource/ibm-plex-mono', 'fonts/plex-mono', ['400', '500']],
  ['@fontsource/ibm-plex-sans-condensed', 'fonts/plex-cond', ['400', '600']],
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [from, to] of FILES) cpSync(join(nm, from), join(out, to));
for (const [pkg, to, weights] of FONTS) {
  for (const w of weights) cpSync(join(nm, pkg, `${w}.css`), join(out, to, `${w}.css`));
  cpSync(join(nm, pkg, 'files'), join(out, to, 'files'), {
    recursive: true,
    filter: (src) => !/italic/.test(src) && (!/\.woff2?$/.test(src) || weights.some((w) => src.includes(`-${w}-`))),
  });
}
process.stdout.write(`vendor : ${FILES.length} fichiers + ${FONTS.length} polices -> public/vendor\n`);
