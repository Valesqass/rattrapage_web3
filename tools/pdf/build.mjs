// Assemble le dossier technique PDF (parties A, B, F + synthese C/D/E) a partir des fichiers Markdown de docs/.
// Usage : cd tools/pdf && npm ci && node build.mjs   ->  docs/dossier-technique.pdf

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, '..', '..', 'docs');
const md = (f) => readFileSync(join(docs, f), 'utf8');

const synthese = `
# Réalisation — parties C, D, E

| Partie | Réalisation | Vérification |
|---|---|---|
| C. Adaptateur MQTT | \`simulator/src/outputs/mqtt/\` : une connexion MQTT par node (clientId, identifiants, Last Will propres) + une passerelle qui diffuse l'horloge de référence ; horodatage \`gwTs\` avant mise en tampon ; tampon borné qui sacrifie d'abord les mesures, jamais les portes ni les acks ; commandes validées, expiration, idempotence ; configuration 100 % variables d'environnement ; sortie console conservée (\`--output console,mqtt\`). \`simulator.js\` et \`scenarios.js\` non modifiés. | 10 tests unitaires ; coupure du broker de 60 s sous Docker : 385 messages par node réémis, aucune perte |
| D. Infrastructure | \`docker compose up\` : Mosquitto 2 (TCP 1883, WebSocket 9001, persistance, fichier de mots de passe généré depuis l'environnement, ACL par rôle), simulateur, front nginx (CSP stricte). | \`tools/acl-check.sh\` : 8/8 contrôles (usurpation, commande d'un autre node, fausse mesure du front, anonyme, mauvais mot de passe) |
| E. Front | HTML/JS sans framework ni backend : client MQTT over WebSocket, session persistante, reconnexion ; vue du site, détail avec courbes 30 min (uPlot), journal des alertes avec acquittement partagé (topic retenu), commandes avec suivi de l'acquittement, état des équipements ; aucun \`innerHTML\` sur des données reçues. | 10 tests du moteur d'alertes, dont le rejeu complet du scénario incidents ; parcours vérifié dans Chrome |
`;

const parts = [md('conception-materielle.md'), md('protocole.md'), synthese, md('validation.md')];

const CAPTURES = [
  ['01-pile', 'Pile faible EXT-02 (07:45)'], ['03-porte-DES-02', 'Porte DES-02 mal refermée'],
  ['04-sonde-TRO-03', 'Sonde TRO-03 déconnectée (−127 °C)'], ['05-lampe-DES-04', 'Lampe DES-04 en panne'],
  ['06-relais-TRO-05', 'TRO-05 : relais bloqué, ack « applied_but_relay_feedback_on »'], ['07-QUA-03', 'QUA-03 hors ligne (Last Will)'],
  ['08-sonde-SOI-02', 'SOI-02 : reset de sonde 85 °C rejeté'], ['09-coupure-QUA', 'Coupure secteur de la quarantaine'],
  ['10-EXT-02', 'EXT-02 : pile épuisée, node hors ligne'], ['11-intrusion', 'Intrusion nocturne 02:37'],
  ['02-derive', 'Dérive d’horloge TRO-06'], ['12-journal', 'Journal des alertes (export CSV/JSON)'],
];
const captureUrl = (n) => pathToFileURL(join(docs, 'captures', `${n}.png`)).href;
const present = CAPTURES.filter(([n]) => existsSync(join(docs, 'captures', `${n}.png`)));
const gallery = `<section class="gallery"><h1>Captures du scénario incidents</h1>${present.map(([n, t]) =>
  `<figure><img src="${captureUrl(n)}"><figcaption>${t}</figcaption></figure>`).join('')}</section>`;

marked.use({ gfm: true });
const body = parts.map((text) => `<section>${marked.parse(text).replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<pre class="mermaid">$1</pre>')}</section>`).join('');

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 14mm 13mm; }
body { font: 9.2pt/1.38 "IBM Plex Sans Condensed", "Segoe UI", sans-serif; color: #1d1b16; }
h1 { font-size: 17pt; border-bottom: 2px solid #1d1b16; padding-bottom: 3pt; margin: 0 0 8pt; break-before: page; }
h2 { font-size: 12pt; margin: 12pt 0 4pt; break-after: avoid; } h3 { font-size: 10.5pt; margin: 9pt 0 3pt; break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 6pt; font-size: 8.2pt; break-inside: avoid; }
th, td { border: 0.5pt solid #b9b09b; padding: 2pt 4pt; vertical-align: top; text-align: left; }
th { background: #ece6d8; }
code, pre { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 7.8pt; }
pre { background: #f4f0e6; padding: 5pt; white-space: pre-wrap; break-inside: avoid; }
p, li { margin: 2pt 0; } ul, ol { padding-left: 14pt; margin: 3pt 0; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover h1 { border: 0; font-size: 26pt; break-before: auto; } .cover p { font-size: 12pt; color: #625c50; }
.gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 10pt; }
.gallery h1 { grid-column: 1 / -1; }
figure { margin: 0; break-inside: avoid; } figure img { width: 100%; height: 62mm; object-fit: cover; object-position: top; border: 0.5pt solid #b9b09b; }
figcaption { font-size: 8pt; color: #625c50; }
pre.mermaid { background: none; text-align: center; }
</style></head><body>
<div class="cover"><h1>Supervision temps réel d'un centre de réhabilitation pour reptiles</h1>
<p>UE02 IoT et systèmes embarqués — dossier technique (parties A, B, F et justification des choix)</p>
<p>Chaîne : simulateur ⇄ MQTT ⇄ Mosquitto ⇄ MQTT over WebSocket ⇄ front web</p></div>
${body}${gallery}</body></html>`;

const tmp = join(here, 'dossier.html');
writeFileSync(tmp, html);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(tmp).href);
await page.addScriptTag({ path: join(here, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js') });
await page.evaluate(async () => {
  window.mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  await window.mermaid.run({ querySelector: 'pre.mermaid' });
});
await page.pdf({ path: join(docs, 'dossier-technique.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:7pt;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
await browser.close();
process.stdout.write('docs/dossier-technique.pdf genere\n');
