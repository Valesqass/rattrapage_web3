// Vue d'ensemble : plan du site par zone, une tuile par enclos / node, fil des alertes actives.

import { h, replace, fmtValue, fmtTime } from '../dom.js';
import { NODES, ZONES, SPECIES } from '../site.js';
import { nodeStatus, activeFor, worstSeverity, sortAlerts, statusDot, alertItem, STATUS_LABEL } from './common.js';

const FEED_LIMIT = 14;

export function overviewView(ctx) {
  const zonesEl = h('div', { class: 'zones' });
  const feedEl = h('ol', { class: 'feed-list' });
  const el = h('div', { class: 'overview' },
    zonesEl,
    h('aside', { class: 'feed', 'aria-label': 'Alertes à traiter' },
      h('header', { class: 'feed-head' }, h('h2', {}, 'À traiter'), h('a', { href: '#/alerts', class: 'link' }, 'Journal complet →')),
      feedEl));

  return {
    el,
    update() {
      replace(zonesEl, ZONES.map((z) => zoneBlock(ctx, z)));
      const pending = sortAlerts(ctx.engine.alerts.filter((a) => a.active || !a.ack)).slice(0, FEED_LIMIT);
      replace(feedEl, pending.length ? pending.map((a) => alertItem(ctx, a, { compact: true })) : h('li', { class: 'feed-empty' }, 'Aucune alerte à traiter.'));
    },
  };
}

function zoneBlock(ctx, z) {
  const nodes = NODES.filter((n) => n.zone === z.id);
  const room = nodes.find((n) => n.kind === 'room');
  const tiles = nodes.filter((n) => n.kind !== 'room');
  const zoneAlert = ctx.engine.active.get(`zone_down|-|${z.id}`);
  return h('section', { class: ['zone', `zone-${z.id}`, zoneAlert ? 'zone-down' : null], 'aria-labelledby': `z-${z.id}` },
    h('header', { class: 'zone-head' },
      h('span', { class: 'zone-code mono' }, z.id),
      h('h2', { id: `z-${z.id}` }, z.label),
      room ? roomSummary(ctx, room) : null),
    zoneAlert ? h('p', { class: 'zone-banner' }, zoneAlert.title, ' — ', zoneAlert.detail) : null,
    h('div', { class: 'tiles' }, tiles.map((n) => (n.kind === 'door' ? doorTile(ctx, n) : enclosureTile(ctx, n)))));
}

function roomSummary(ctx, room) {
  const amb = ctx.store.value(room.id, 'temp_ambient');
  const st = ctx.engine.state(room.id);
  const status = nodeStatus(ctx, room.id);
  return h('a', { href: `#/node/${room.id}`, class: 'room-summary' },
    statusDot(status),
    h('span', { class: 'mono' }, amb?.valid ? fmtValue('temp_ambient', amb.value) : '—'),
    h('span', { class: ['door-pill', st.door.open ? 'is-open' : null] }, st.door.open ? 'porte ouverte' : 'porte fermée'));
}

function metric(label, sensor, reading) {
  const bad = reading && !reading.valid;
  return h('div', { class: ['metric', bad ? 'is-bad' : null] },
    h('dt', {}, label),
    h('dd', { class: 'mono' }, reading ? (bad ? `${reading.value} ?` : fmtValue(sensor, reading.value)) : '—'));
}

function enclosureTile(ctx, def) {
  const st = ctx.engine.state(def.id);
  const status = nodeStatus(ctx, def.id);
  const sev = worstSeverity(activeFor(ctx, def.id));
  const v = (s) => ctx.store.value(def.id, s);
  return h('a', { href: `#/node/${def.id}`, class: ['tile', `sev-${sev}`, `st-${status}`], 'aria-label': `${def.enclosure}, ${STATUS_LABEL[status]}` },
    h('div', { class: 'tile-head' }, h('span', { class: 'tile-id mono' }, def.enclosure), statusDot(status)),
    h('div', { class: 'tile-species' }, SPECIES[def.species].label),
    h('dl', { class: 'tile-values' }, metric('chaud', 'temp_hot', v('temp_hot')), metric('froid', 'temp_cold', v('temp_cold')), metric('lumière', 'light', v('light'))),
    h('div', { class: 'tile-foot' },
      h('span', { class: ['door-pill', st.door.open ? 'is-open' : null] }, st.door.open ? `ouverte ${fmtTime(st.door.since)}` : 'fermée'),
      st.battery !== null ? h('span', { class: ['battery', st.battery < 20 ? 'is-low' : null], title: 'Pile' }, `${st.battery} %`) : null));
}

function doorTile(ctx, def) {
  const st = ctx.engine.state(def.id);
  const status = nodeStatus(ctx, def.id);
  const sev = worstSeverity(activeFor(ctx, def.id));
  const last = ctx.store.doors.get(def.id)?.[0];
  return h('a', { href: `#/node/${def.id}`, class: ['tile', 'tile-door', `sev-${sev}`, `st-${status}`] },
    h('div', { class: 'tile-head' }, h('span', { class: 'tile-id' }, def.label), statusDot(status)),
    h('div', { class: ['door-state', st.door.open ? 'is-open' : null] }, st.door.open ? 'Ouverte' : 'Fermée'),
    h('div', { class: 'tile-foot' },
      h('span', { class: 'muted' }, last ? `dernier mouvement ${fmtTime(last.gwTs)}` : 'aucun mouvement'),
      st.battery !== null ? h('span', { class: ['battery', st.battery < 20 ? 'is-low' : null] }, `${st.battery} %`) : null));
}
