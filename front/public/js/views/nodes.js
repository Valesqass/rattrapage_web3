// Etat de chaque node : connexion, dernier message, radio, pile, horloge, alertes actives.

import { h, replace, fmtAge } from '../dom.js';
import { NODES, ZONES } from '../site.js';
import { nodeStatus, statusDot, STATUS_LABEL, activeFor, worstSeverity, sevChip } from './common.js';

export function nodesView(ctx) {
  const tbody = h('tbody');
  const el = h('section', { class: 'nodes-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Équipements'),
      h('p', { class: 'muted' }, `${NODES.length} nodes provisionnés. « Hors ligne » = Last Will reçu ; « Muet » = plus de message depuis 3 périodes.`)),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Node', 'Zone', 'Type', 'État', 'Dernier message', 'RSSI', 'Pile', 'Firmware', 'Horloge', 'Alertes'].map((c) => h('th', { scope: 'col' }, c)))),
        tbody)));
  return {
    el,
    update() {
      replace(tbody, NODES.map((def) => row(ctx, def)));
    },
  };
}

const KIND_LABEL = { enclosure: 'Enclos', outdoor: 'Extérieur', room: 'Ambiance salle', door: 'Porte' };

function row(ctx, def) {
  const st = ctx.engine.state(def.id);
  const status = nodeStatus(ctx, def.id);
  const active = activeFor(ctx, def.id);
  return h('tr', { class: `st-${status}` },
    h('td', {}, h('a', { href: `#/node/${def.id}`, class: 'mono' }, def.id)),
    h('td', {}, ZONES.find((z) => z.id === def.zone)?.label ?? def.zone),
    h('td', {}, KIND_LABEL[def.kind]),
    h('td', {}, statusDot(status), ' ', STATUS_LABEL[status]),
    h('td', { class: 'mono' }, st.lastSeen ? `il y a ${fmtAge(ctx.engine.now - st.lastSeen)}` : '—'),
    h('td', { class: 'mono' }, st.rssi !== null ? `${st.rssi} dBm` : '—'),
    h('td', { class: 'mono' }, def.power === 'battery' ? (st.battery !== null ? `${st.battery} %` : '—') : 'secteur'),
    h('td', { class: 'mono' }, st.fw ?? '—'),
    h('td', { class: 'mono' }, st.clockOffsetMs === null ? (st.lastSeen ? 'non sync.' : '—') : `${Math.round(st.clockOffsetMs / 1000)} s`),
    h('td', {}, active.length ? [sevChip(worstSeverity(active)), ` ${active.length}`] : h('span', { class: 'muted' }, '—')));
}
