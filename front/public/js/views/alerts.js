// Journal des alertes : filtres, acquittement, export (pour le rapport de validation).

import { h, replace, fmtTime, fmtTimeSec, SEVERITY_LABEL } from '../dom.js';
import { sevChip, placeOf } from './common.js';

const FILTERS = [
  ['todo', 'À traiter', (a) => a.active || !a.ack],
  ['active', 'En cours', (a) => a.active],
  ['all', 'Toutes', () => true],
];

export function alertsView(ctx) {
  let filter = 'todo';
  const tbody = h('tbody');
  const countEl = h('span', { class: 'muted' });
  const filterBtns = FILTERS.map(([key, label]) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(key === filter), onclick: () => {
    filter = key;
    filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(FILTERS[i][0] === filter)));
    view.update();
  } }, label));

  const visible = () => sortByTime(ctx.engine.alerts.filter(FILTERS.find(([k]) => k === filter)[2]));
  const ackAll = () => visible().filter((a) => !a.ack).forEach((a) => ctx.ackAlert(a));

  const el = h('section', { class: 'alerts-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Journal des alertes'),
      h('p', { class: 'muted' }, 'Heures du site (horloge passerelle). Délai = détection − début de l’anomalie.')),
    h('div', { class: 'toolbar' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filtre' }, filterBtns),
      countEl,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: ackAll }, 'Acquitter les alertes affichées'),
      h('button', { type: 'button', class: 'btn', onclick: () => download('alertes.csv', toCsv(ctx.engine.alerts), 'text/csv') }, 'Export CSV'),
      h('button', { type: 'button', class: 'btn', onclick: () => download('alertes.json', JSON.stringify(ctx.engine.alerts, null, 2), 'application/json') }, 'Export JSON')),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Gravité', 'Lieu', 'Alerte', 'Détail', 'Début', 'Détection', 'Délai', 'Fin', 'Acquittement'].map((c) => h('th', { scope: 'col' }, c)))),
        tbody)));

  const view = {
    el,
    update() {
      const rows = visible();
      countEl.textContent = `${rows.length} alerte(s)`;
      replace(tbody, rows.length ? rows.map((a) => row(ctx, a)) : h('tr', {}, h('td', { colspan: 9, class: 'feed-empty' }, 'Rien à afficher.')));
    },
  };
  return view;
}

const sortByTime = (list) => [...list].sort((a, b) => b.detectedAt - a.detectedAt);

function row(ctx, a) {
  const delayS = Math.max(0, Math.round((a.detectedAt - a.startedAt) / 1000));
  return h('tr', { class: [`row-${a.severity}`, a.active ? 'is-active' : null] },
    h('td', {}, sevChip(a.severity)),
    h('td', {}, a.node ? h('a', { href: `#/node/${a.node}` }, placeOf(a)) : placeOf(a)),
    h('td', { class: 'strong' }, a.title),
    h('td', {}, a.detail),
    h('td', { class: 'mono' }, fmtTimeSec(a.startedAt)),
    h('td', { class: 'mono' }, fmtTimeSec(a.detectedAt)),
    h('td', { class: 'mono' }, delayS < 60 ? `${delayS} s` : `${Math.round(delayS / 60)} min`),
    h('td', { class: 'mono' }, a.active ? 'en cours' : fmtTime(a.endedAt)),
    h('td', {}, a.ack ? `${fmtTime(a.ack.at)} (${a.ack.by})` : h('button', { type: 'button', class: 'btn btn-ack', onclick: () => ctx.ackAlert(a) }, 'Acquitter')));
}

function toCsv(alerts) {
  const cols = ['id', 'severity', 'node', 'zone', 'sensor', 'title', 'detail', 'startedAt', 'detectedAt', 'endedAt', 'ackAt', 'ackBy'];
  const iso = (t) => (t ? new Date(t).toISOString() : '');
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = alerts.map((a) => [a.id, SEVERITY_LABEL[a.severity], a.node, a.zone, a.sensor, a.title, a.detail, iso(a.startedAt), iso(a.detectedAt), iso(a.endedAt), iso(a.ack?.at), a.ack?.by].map(esc).join(','));
  return [cols.join(','), ...lines].join('\n');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
