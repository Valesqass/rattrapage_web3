// Detail d'un node : valeurs courantes, courbes des 30 dernieres minutes, sante, commandes.

import uPlot from '../../vendor/uPlot.esm.js';
import { h, replace, fmtValue, fmtTime, fmtTimeSec, fmtAge } from '../dom.js';
import { NODE_BY_ID, SPECIES, SENSOR_LABEL, SITE_TZ, siteHour } from '../site.js';
import { expectedRange } from '../rules.js';
import { COMMAND_STATE_LABEL } from '../commands.js';
import { nodeStatus, statusDot, STATUS_LABEL, alertItem, sortAlerts } from './common.js';

const CHART_HEIGHT = 230;
const REBOOT_CONFIRM_MS = 4000;

export function detailView(ctx, nodeId) {
  const def = NODE_BY_ID.get(nodeId);
  if (!def) return { el: h('p', { class: 'empty' }, `Node inconnu : ${nodeId}`), update() {} };

  const metricsEl = h('div', { class: 'kpis' });
  const healthEl = h('dl', { class: 'health' });
  const logEl = h('ol', { class: 'cmd-log' });
  const doorsEl = h('ol', { class: 'door-log' });
  const alertsEl = h('ol', { class: 'feed-list' });
  const charts = [];
  const tempSensors = def.sensors.filter((s) => s !== 'light');

  const chartBox = (title, legend) => {
    const box = h('div', { class: 'chart' });
    return { box, wrap: h('figure', { class: 'chart-card' }, h('figcaption', {}, title, h('span', { class: 'legend' }, legend)), box) };
  };
  const temp = tempSensors.length ? chartBox('Températures · 30 dernières minutes', tempLegend(def)) : null;
  const light = def.sensors.includes('light') ? chartBox('Lumière · 30 dernières minutes', '') : null;

  const el = h('article', { class: 'detail' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Site'), ' / ', def.zone, ' / ', def.enclosure ?? def.label),
    h('header', { class: 'detail-head' },
      h('h1', {}, def.enclosure ?? def.label),
      def.species ? h('p', { class: 'species' }, SPECIES[def.species].label, speciesNote(def)) : h('p', { class: 'species' }, def.id)),
    metricsEl,
    h('div', { class: 'detail-grid' },
      h('div', { class: 'detail-main' },
        temp?.wrap, light?.wrap,
        h('section', { class: 'card' }, h('h2', {}, 'Alertes de ce node'), alertsEl)),
      h('div', { class: 'detail-side' },
        h('section', { class: 'card' }, h('h2', {}, 'Santé du node'), healthEl),
        commandPanel(ctx, def, logEl),
        h('section', { class: 'card' }, h('h2', {}, 'Mouvements de porte'), doorsEl))));

  const resizeObs = new ResizeObserver(() => charts.forEach(({ plot, box }) => plot.setSize({ width: box.clientWidth, height: CHART_HEIGHT })));

  function ensureCharts() {
    if (charts.length || !el.isConnected) return;
    if (temp) charts.push({ box: temp.box, plot: makeTempChart(temp.box, def, tempSensors), kind: 'temp' });
    if (light) charts.push({ box: light.box, plot: makeLightChart(light.box), kind: 'light' });
    charts.forEach(({ box }) => resizeObs.observe(box));
  }

  return {
    el,
    update() {
      ensureCharts();
      const now = ctx.engine.now;
      for (const c of charts) c.plot.setData(c.kind === 'temp' ? tempData(ctx, def, tempSensors, now) : lightData(ctx, def, now));
      replace(metricsEl, def.sensors.map((s) => kpi(ctx, def, s)));
      replace(healthEl, health(ctx, def));
      replace(logEl, commandLog(ctx, def));
      const doors = ctx.store.doors.get(def.id) ?? [];
      replace(doorsEl, doors.length ? doors.map((d) => h('li', {}, h('span', { class: 'mono' }, fmtTimeSec(d.gwTs)), ' ', d.state === 'open' ? 'ouverture' : 'fermeture')) : h('li', { class: 'muted' }, 'Aucun mouvement reçu.'));
      const mine = sortAlerts(ctx.engine.alerts.filter((a) => a.node === def.id)).slice(0, 12);
      replace(alertsEl, mine.length ? mine.map((a) => alertItem(ctx, a)) : h('li', { class: 'feed-empty' }, 'Aucune alerte.'));
    },
    unmount() {
      resizeObs.disconnect();
      charts.forEach(({ plot }) => plot.destroy());
    },
  };
}

function speciesNote(def) {
  const p = SPECIES[def.species];
  if (p.outdoor) return ' · enclos extérieur sur pile';
  return ` · point chaud ${p.hotDay} °C · froid ${p.coldDay.join('–')} °C · nuit ${p.night.join('–')} °C · jour ${p.photo[0]} h–${p.photo[1]} h`;
}

function kpi(ctx, def, sensor) {
  const r = ctx.store.value(def.id, sensor);
  const range = sensor === 'light' ? null : expectedRange(def, sensor, siteHour(ctx.engine.now || Date.now()));
  const active = ctx.engine.active.get(`threshold|${def.id}|${sensor}`) ?? ctx.engine.active.get(`sensor_fault|${def.id}|${sensor}`);
  return h('div', { class: ['kpi', active ? `kpi-${active.severity}` : null] },
    h('div', { class: 'kpi-label' }, SENSOR_LABEL[sensor]),
    h('div', { class: 'kpi-value mono' }, r ? (r.valid ? fmtValue(sensor, r.value) : `${r.value} (rejetée)`) : '—'),
    h('div', { class: 'kpi-sub' }, range?.warn ? `attendu ${range.warn[0]}–${range.warn[1]} °C (${range.phase})` : range ? `phase ${range.phase}` : '', r ? ` · reçu ${fmtTime(r.gwTs)}` : ''));
}

function health(ctx, def) {
  const st = ctx.engine.state(def.id);
  const status = nodeStatus(ctx, def.id);
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  return [
    row('État', [statusDot(status), ' ', STATUS_LABEL[status], st.offlineReason ? ` (${st.offlineReason})` : '']),
    row('Dernier message', st.lastSeen ? `${fmtTimeSec(st.lastSeen)} · il y a ${fmtAge(ctx.engine.now - st.lastSeen)}` : '—'),
    row('Alimentation', def.power === 'battery' ? `pile ${st.battery ?? '—'} %` : 'secteur'),
    row('Radio (RSSI)', st.rssi !== null ? `${st.rssi} dBm` : '—'),
    row('Firmware', st.fw ?? '—'),
    row('Uptime', st.uptimeS !== null ? fmtAge(st.uptimeS * 1000) : '—'),
    row('Horloge', st.clockOffsetMs === null ? 'non synchronisée / inconnue' : `écart ${Math.round(st.clockOffsetMs / 1000)} s`),
    row('Identifiant', h('code', {}, def.id)),
  ];
}

// ------------------------------------------------------------------ commandes
const COMMANDS = {
  enclosure: ['lamp', 'light', 'setpoint', 'safety_cut', 'interval', 'identify', 'reboot'],
  outdoor: ['interval', 'identify', 'reboot'],
  room: ['interval', 'identify', 'reboot'],
  door: ['identify', 'reboot'],
};

function commandPanel(ctx, def, logEl) {
  const allowed = new Set(COMMANDS[def.kind]);
  const send = (action, value) => ctx.commands.send(def, action, value);
  const modeRow = (action, label) => allowed.has(action) && h('div', { class: 'cmd-row' },
    h('span', { class: 'cmd-label' }, label),
    h('div', { class: 'segmented', role: 'group', 'aria-label': label },
      [['auto', 'Auto'], ['on', 'Marche'], ['off', 'Arrêt']].map(([v, l]) => h('button', { type: 'button', class: 'btn', onclick: () => send(action, v) }, l))));
  const numberRow = (action, label, min, max, step, unit) => {
    if (!allowed.has(action)) return null;
    const input = h('input', { type: 'number', min, max, step, required: true, 'aria-label': label, class: 'mono' });
    return h('form', { class: 'cmd-row', onsubmit: (e) => {
      e.preventDefault();
      const v = Number(input.value);
      if (!input.checkValidity() || !Number.isFinite(v)) {
        input.reportValidity();
        return;
      }
      send(action, v);
    } }, h('label', { class: 'cmd-label' }, label), h('span', { class: 'cmd-input' }, input, h('span', { class: 'unit' }, unit)), h('button', { type: 'submit', class: 'btn' }, 'Appliquer'));
  };
  const rebootBtn = h('button', { type: 'button', class: 'btn btn-danger' }, 'Redémarrer');
  let armed = null;
  rebootBtn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      rebootBtn.textContent = 'Redémarrer';
      send('reboot', null);
      return;
    }
    rebootBtn.textContent = 'Confirmer le redémarrage';
    armed = setTimeout(() => { armed = null; rebootBtn.textContent = 'Redémarrer'; }, REBOOT_CONFIRM_MS);
  });

  return h('section', { class: 'card commands' },
    h('h2', {}, 'Commandes'),
    modeRow('lamp', 'Lampe chauffante'),
    modeRow('light', 'Éclairage'),
    numberRow('setpoint', 'Consigne point chaud', 20, 50, 0.5, '°C'),
    allowed.has('safety_cut') && h('div', { class: 'cmd-row' }, h('span', { class: 'cmd-label' }, 'Coupure sécurité'),
      h('div', { class: 'segmented' },
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => send('safety_cut', true) }, 'Couper le chauffage'),
        h('button', { type: 'button', class: 'btn', onclick: () => send('safety_cut', false) }, 'Rétablir'))),
    numberRow('interval', 'Période de mesure', 5, 3600, 1, 's'),
    h('div', { class: 'cmd-row cmd-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => send('identify', null) }, 'Identifier (LED)'),
      allowed.has('reboot') ? rebootBtn : null),
    h('h3', {}, 'Suivi des commandes'),
    logEl);
}

function commandLog(ctx, def) {
  const items = ctx.commands.forNode(def.id);
  if (!items.length) return [h('li', { class: 'muted' }, 'Aucune commande envoyée depuis ce poste.')];
  return items.slice(0, 8).map((c) => h('li', { class: ['cmd', `cmd-${c.state}`] },
    h('span', { class: 'mono' }, fmtTimeSec(c.sentGw)),
    h('span', { class: 'cmd-what' }, c.value === null || c.value === undefined ? c.action : `${c.action} = ${c.value}`),
    h('span', { class: 'cmd-state' }, COMMAND_STATE_LABEL[c.state]),
    c.detail ? h('span', { class: 'cmd-detail mono' }, c.detail) : null,
    ['timeout', 'error'].includes(c.state) ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => ctx.commands.resend(c.id) }, 'Renvoyer') : null));
}

// ------------------------------------------------------------------ courbes
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function tempLegend(def) {
  if (def.kind === 'room') return ' ambiance';
  if (def.kind === 'outdoor') return ' — point chaud · — point froid';
  return ' — point chaud · — point froid · ┄ plage tolérée (point chaud)';
}

function baseOpts(box, series, yFmt) {
  const axis = { stroke: css('--ink-2'), grid: { stroke: css('--rule'), width: 1 }, ticks: { stroke: css('--rule') }, font: '12px "IBM Plex Mono", monospace' };
  return {
    width: box.clientWidth || 600,
    height: CHART_HEIGHT,
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), SITE_TZ),
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: true } },
    axes: [{ ...axis, values: (u, vals) => vals.map((s) => fmtTime(s * 1000)) }, { ...axis, values: (u, vals) => vals.map(yFmt), size: 60 }],
    series: [{}, ...series],
  };
}

function makeTempChart(box, def, sensors) {
  const color = { temp_hot: css('--c-hot'), temp_cold: css('--c-cold'), temp_ambient: css('--c-hot') };
  const series = sensors.map((s) => ({ label: SENSOR_LABEL[s], stroke: color[s], width: 2, spanGaps: false }));
  if (def.kind === 'enclosure') {
    const bound = (label) => ({ label, stroke: css('--ink-2'), width: 1, dash: [4, 4], points: { show: false } });
    series.push(bound('min'), bound('max'));
  }
  return new uPlot(baseOpts(box, series, (v) => `${v} °C`), [[], ...series.map(() => [])], box);
}

function makeLightChart(box) {
  return new uPlot(baseOpts(box, [{ label: 'Lumière', stroke: css('--c-light'), width: 2, fill: css('--c-light-fill') }], (v) => (v >= 1000 ? `${v / 1000} k` : `${v}`)), [[], []], box);
}

function tempData(ctx, def, sensors, now) {
  const main = ctx.store.window(def.id, sensors[0], now);
  const xs = main.map((p) => p[0]);
  const others = sensors.slice(1).map((s) => new Map(ctx.store.window(def.id, s, now)));
  const cols = [xs.map((t) => t / 1000), main.map((p) => p[1]), ...others.map((m) => xs.map((t) => m.get(t) ?? null))];
  if (def.kind === 'enclosure') {
    const ranges = xs.map((t) => expectedRange(def, 'temp_hot', siteHour(t)));
    cols.push(ranges.map((r) => (r?.warn ? r.warn[0] : null)), ranges.map((r) => (r?.warn ? r.warn[1] : null)));
  }
  return cols;
}

function lightData(ctx, def, now) {
  const s = ctx.store.window(def.id, 'light', now);
  return [s.map((p) => p[0] / 1000), s.map((p) => p[1])];
}
