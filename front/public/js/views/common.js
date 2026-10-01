// Briques partagees par les vues : statut d'un node, gravite, rendu d'une alerte.

import { h, fmtTime, fmtAge, SEVERITY_LABEL } from '../dom.js';
import { NODE_BY_ID, ZONES } from '../site.js';
import { SEVERITY_RANK } from '../engine.js';

export const STATUS_LABEL = { online: 'En ligne', offline: 'Hors ligne', silent: 'Muet', unknown: 'Inconnu' };

export function nodeStatus(ctx, nodeId) {
  const st = ctx.engine.state(nodeId);
  if (!st) return 'unknown';
  if (st.online === false) return 'offline';
  if (ctx.engine.active.has(`node_silent|${nodeId}|-`)) return 'silent';
  if (st.online === true || st.lastSeen) return 'online';
  return 'unknown';
}

export function activeFor(ctx, nodeId) {
  return [...ctx.engine.active.values()].filter((a) => a.node === nodeId);
}

export function worstSeverity(alerts) {
  return alerts.reduce((w, a) => (!w || SEVERITY_RANK[a.severity] > SEVERITY_RANK[w] ? a.severity : w), null) ?? 'ok';
}

export function sortAlerts(list) {
  return [...list].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.detectedAt - a.detectedAt);
}

export const statusDot = (status) => h('span', { class: ['dot', `dot-${status}`], title: STATUS_LABEL[status], 'aria-label': STATUS_LABEL[status] });

export const sevChip = (sev) => h('span', { class: ['chip', `chip-${sev}`] }, SEVERITY_LABEL[sev] ?? sev);

export function placeOf(alert) {
  const def = NODE_BY_ID.get(alert.node);
  if (def) return def.enclosure ?? def.label;
  return ZONES.find((z) => z.id === alert.zone)?.label ?? alert.node ?? '—';
}

/** Une alerte en ligne : gravite, lieu, titre, detail, horodatages, acquittement. */
export function alertItem(ctx, a, { compact = false } = {}) {
  const def = NODE_BY_ID.get(a.node);
  const place = def ? h('a', { href: `#/node/${def.id}`, class: 'alert-place' }, placeOf(a)) : h('span', { class: 'alert-place' }, placeOf(a));
  const ackZone = a.ack
    ? h('span', { class: 'ack-done' }, `acquittée ${fmtTime(a.ack.at)}`)
    : h('button', { class: 'btn btn-ack', type: 'button', onclick: () => ctx.ackAlert(a) }, 'Acquitter');
  return h('li', { class: ['alert', `alert-${a.severity}`, a.active ? 'is-active' : 'is-ended', a.ack ? 'is-acked' : 'is-unacked'] },
    h('div', { class: 'alert-line' }, sevChip(a.severity), place, h('span', { class: 'alert-time mono' }, fmtTime(a.startedAt))),
    h('div', { class: 'alert-title' }, a.title),
    compact ? null : h('div', { class: 'alert-detail' }, a.detail),
    h('div', { class: 'alert-foot' },
      h('span', { class: 'muted' }, a.active ? `en cours · ${fmtAge(ctx.engine.now - a.startedAt)}` : `terminée ${fmtTime(a.endedAt)}`),
      ackZone));
}
