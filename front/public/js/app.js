// Point d'entree du front : connexion au broker, routage, horloge de reference et boucle de rendu.

import { AlertEngine } from './engine.js';
import { Store } from './store.js';
import { Commands } from './commands.js';
import { connect, stableClientId, ROOT } from './connection.js';
import { h, replace, fmtTime, fmtDate } from './dom.js';
import { overviewView } from './views/overview.js';
import { detailView } from './views/detail.js';
import { alertsView } from './views/alerts.js';
import { nodesView } from './views/nodes.js';

const CREDS_KEY = 'rc.creds';
const TICK_MS = 1000;
const SAVE_MS = 10_000;
const RENDER_MIN_MS = 300;
const GATEWAY_STALE_MS = 15_000;

const CONN_LABEL = {
  idle: 'Non connecté',
  connecting: 'Connexion…',
  connected: 'Connecté',
  reconnecting: 'Reconnexion…',
  offline: 'Hors ligne · reprise auto',
  unauthorized: 'Accès refusé',
  error: 'Erreur',
};

const engine = new AlertEngine();
const store = new Store();
store.load(engine);
const clientId = stableClientId();
let conn = null;
let connState = { state: 'idle', detail: '' };
let gatewaySeenAt = 0;
const commands = new Commands({ getConnection: () => conn, engine, onChange: schedule });
const ctx = { engine, store, commands, ackAlert };

const $ = (id) => document.getElementById(id);
const main = $('main');

// ------------------------------------------------------------------ messages
function onMessage(t, p) {
  if (t.kind === 'gateway') {
    if (p?.online === false) store.gateway = { ...store.gateway, online: false };
    else if (p && Number.isFinite(p.gwTs)) {
      store.gateway = { online: true, gwTs: p.gwTs, speed: p.speed, scenario: p.scenario };
      gatewaySeenAt = Date.now();
      engine.tick(p.gwTs);
    }
  } else if (t.kind === 'alert_ack') {
    if (p) engine.applyAck(t.alertId, p);
  } else if (p) {
    const fresh = engine.ingest({ kind: t.kind, nodeId: t.nodeId, sensor: t.sensor, payload: p });
    if (fresh && t.kind === 'reading') {
      const valid = engine.state(t.nodeId)?.lastValid[t.sensor]?.gwTs === p.gwTs;
      store.addReading(t.nodeId, t.sensor, p.gwTs, p.value, valid, engine.now);
    }
    if (fresh && t.kind === 'door') store.addDoor(t.nodeId, p.gwTs, p.state);
    if (t.kind === 'ack') commands.onAck(p);
  }
  schedule();
}

function ackAlert(a) {
  const ack = { v: 1, by: clientId, at: engine.now };
  engine.applyAck(a.id, ack);
  conn?.publish(`${ROOT}/alerts/${a.id}/ack`, ack, { qos: 1, retain: true })
    .catch((err) => console.warn('[alertes] acquittement non publie', err));
  schedule();
}

// ------------------------------------------------------------------ connexion
function readCreds() {
  try {
    return JSON.parse(sessionStorage.getItem(CREDS_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function start(creds) {
  conn?.end();
  conn = connect({
    ...creds,
    clientId,
    onMessage,
    onState(state, detail = '') {
      connState = { state, detail };
      if (state === 'unauthorized') {
        sessionStorage.removeItem(CREDS_KEY);
        conn = null;
        showLogin('Identifiants refusés par le broker.');
      }
      schedule();
    },
  });
  mountView();
}

function logout() {
  conn?.end();
  conn = null;
  connState = { state: 'idle', detail: '' };
  sessionStorage.removeItem(CREDS_KEY);
  showLogin();
}

function showLogin(message) {
  current?.unmount?.();
  current = null;
  const defaults = readCreds() ?? { url: `ws://${location.hostname || 'localhost'}:9001`, username: 'front' };
  const url = h('input', { name: 'url', value: defaults.url, required: true, class: 'mono', autocomplete: 'off' });
  const user = h('input', { name: 'username', value: defaults.username, required: true, autocomplete: 'username' });
  const pass = h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const form = h('form', { class: 'login card', onsubmit: (e) => {
    e.preventDefault();
    if (!/^wss?:\/\//.test(url.value)) {
      url.setCustomValidity('Adresse ws:// ou wss:// attendue');
      url.reportValidity();
      return;
    }
    const creds = { url: url.value.trim(), username: user.value.trim(), password: pass.value };
    sessionStorage.setItem(CREDS_KEY, JSON.stringify(creds));
    start(creds);
  } },
  h('h1', {}, 'Connexion au broker'),
  h('p', { class: 'muted' }, 'Le navigateur se connecte directement au broker MQTT (WebSocket). Compte opérateur : rôle « front ».'),
  message ? h('p', { class: 'form-error', role: 'alert' }, message) : null,
  h('label', {}, 'Broker', url),
  h('label', {}, 'Utilisateur', user),
  h('label', {}, 'Mot de passe', pass),
  h('button', { type: 'submit', class: 'btn btn-primary' }, 'Se connecter'),
  h('p', { class: 'muted small' }, `Identifiant de session : ${clientId}`));
  url.addEventListener('input', () => url.setCustomValidity(''));
  replace(main, form);
  pass.focus();
  schedule();
}

// ------------------------------------------------------------------ routage
let current = null;
const ROUTES = [
  [/^#\/node\/(.+)$/, (m) => detailView(ctx, decodeURIComponent(m[1])), 'site'],
  [/^#\/alerts$/, () => alertsView(ctx), 'alerts'],
  [/^#\/nodes$/, () => nodesView(ctx), 'nodes'],
  [/^/, () => overviewView(ctx), 'site'],
];

function mountView() {
  if (!conn) return;
  const hash = location.hash || '#/';
  const [re, make, tab] = ROUTES.find(([r]) => r.test(hash));
  current?.unmount?.();
  current = make(hash.match(re));
  replace(main, current.el);
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  window.scrollTo({ top: 0 });
  current.update();
}

// ------------------------------------------------------------------ en-tete et rendu
function renderHeader() {
  const s = connState.state;
  const pill = $('conn');
  pill.className = `conn conn-${s}`;
  pill.textContent = CONN_LABEL[s] ?? s;
  pill.title = connState.detail;

  $('clock').textContent = engine.now ? fmtTime(engine.now) : '--:--';
  $('date').textContent = engine.now ? fmtDate(engine.now) : 'en attente de la passerelle';
  const gw = store.gateway;
  const stale = gw.online && Date.now() - gatewaySeenAt > GATEWAY_STALE_MS;
  const gwEl = $('gateway');
  gwEl.textContent = gw.online === false ? 'Passerelle hors ligne' : stale ? 'Passerelle muette' : gw.online ? `Passerelle OK · ×${gw.speed} · ${gw.scenario}` : 'Passerelle : —';
  gwEl.className = `gw ${gw.online === false || stale ? 'gw-bad' : ''}`;

  const pending = engine.alerts.filter((a) => a.active || !a.ack);
  $('count-critical').textContent = pending.filter((a) => a.severity === 'critical').length;
  $('count-warning').textContent = pending.filter((a) => a.severity === 'warning').length;
  $('logout').hidden = !conn;
}

let scheduled = false;
let lastRender = 0;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const wait = Math.max(0, RENDER_MIN_MS - (performance.now() - lastRender));
  setTimeout(() => requestAnimationFrame(() => {
    scheduled = false;
    lastRender = performance.now();
    renderHeader();
    current?.update();
  }), wait);
}

// ------------------------------------------------------------------ demarrage
window.addEventListener('hashchange', mountView);
$('logout').addEventListener('click', logout);
setInterval(() => {
  engine.tick();
  schedule();
}, TICK_MS);
setInterval(() => store.save(engine), SAVE_MS);
window.addEventListener('pagehide', () => store.save(engine));

const saved = readCreds();
if (saved) start(saved);
else showLogin();
