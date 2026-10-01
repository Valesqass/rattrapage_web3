// Construction du DOM sans innerHTML : toute donnee recue du broker est inseree en texte.

import { SITE_TZ } from './site.js';

/**
 * h('div', { class: 'x', onclick: fn, dataset: { id } }, 'texte', enfant, [enfants])
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function replace(container, ...children) {
  container.replaceChildren();
  append(container, children);
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: SITE_TZ, hour: '2-digit', minute: '2-digit' });
const timeSecFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: SITE_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: SITE_TZ, weekday: 'long', day: 'numeric', month: 'long' });

export const fmtTime = (ts) => (ts ? timeFmt.format(ts) : '—');
export const fmtTimeSec = (ts) => (ts ? timeSecFmt.format(ts) : '—');
export const fmtDate = (ts) => (ts ? dateFmt.format(ts) : '');

export function fmtAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export function fmtValue(sensor, v) {
  if (!Number.isFinite(v)) return '—';
  if (sensor === 'light') return v >= 10000 ? `${(v / 1000).toFixed(1)} klx` : `${Math.round(v)} lx`;
  return `${v.toFixed(1)} °C`;
}

export const SEVERITY_LABEL = { critical: 'Critique', warning: 'Avertissement', info: 'Info' };
