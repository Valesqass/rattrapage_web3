// Moteur d'alertes : etat par node + cycle de vie des alertes (ouverte -> resolue, acquittee ou non).
// L'horloge de reference est le plus grand gwTs recu (docs/protocole.md §5), jamais l'horloge du poste.

import { NODE_BY_ID, NODES, ZONES, DOOR_LIMITS, OPENING_HOURS, SENSOR_LABEL, siteHour } from './site.js';
import { aberration, expectedRange, classify, lightAnomaly } from './rules.js';

const SCHEMA_VERSION = 1;
const CLOCK_SANE_AFTER = Date.UTC(2020, 0, 1);
const CLOCK_DRIFT_MAX_MS = 60_000;
const DEBOUNCE_READINGS = 2; // lectures hors plage consecutives avant alerte (filtre le bruit)
const FAULT_CLEAR_READINGS = 10; // lectures valides consecutives avant de lever un defaut capteur (reset intermittent)
const HYSTERESIS_C = 0.5; // une alerte de seuil ne se leve qu'une fois revenu franchement dans la plage
const BATTERY_WARN = 20;
const BATTERY_CRIT = 10;
const BATTERY_CLEAR = 25;
const MIN_SILENCE_S = 180;
const ZONE_DOWN_MIN_NODES = 3;
const MAX_ALERTS = 500;
const SEEN_MEMORY = 5000;

export const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

const emptyState = () => ({
  online: null, offlineReason: null, lastSeen: 0, sensorSeen: {}, lastValid: {}, outCount: {}, firstOut: {}, validStreak: {},
  door: { open: false, since: null }, battery: null, rssi: null, fw: null, uptimeS: null, clockOffsetMs: null, periodS: null,
  awakeSince: 0,
});

export class AlertEngine {
  constructor() {
    this.now = 0;
    this.nodes = new Map(NODES.map((n) => [n.id, emptyState()]));
    this.alerts = [];
    this.active = new Map();
    this.pendingAcks = new Map();
    this.seen = new Set();
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #changed() {
    this.listeners.forEach((fn) => fn());
  }

  state(nodeId) {
    return this.nodes.get(nodeId);
  }

  // ---------------------------------------------------------------- cycle de vie
  #raise(rule, nodeId, sensor, severity, { title, detail, value = null, startedAt = this.now, event = false }) {
    const key = `${rule}|${nodeId ?? '-'}|${sensor ?? '-'}`;
    const existing = this.active.get(key);
    if (existing) {
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) {
        Object.assign(existing, { severity, title, detail, ack: null, escalatedAt: this.now });
      }
      Object.assign(existing, { value, lastDetail: detail });
      return existing;
    }
    const def = NODE_BY_ID.get(nodeId);
    const id = `${rule}~${nodeId ?? '-'}~${sensor ?? '-'}~${startedAt}`.replace(/[^A-Za-z0-9_~.-]/g, '_');
    const alert = {
      id, key, rule, severity, title, detail, value, sensor,
      node: nodeId, zone: def?.zone ?? (nodeId ? null : sensor), enclosure: def?.enclosure ?? null,
      startedAt, detectedAt: this.now, endedAt: event ? startedAt : null, active: !event,
      ack: this.pendingAcks.get(id) ?? null,
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > MAX_ALERTS) this.alerts.length = MAX_ALERTS;
    if (!event) this.active.set(key, alert);
    return alert;
  }

  #resolve(rule, nodeId, sensor) {
    const key = `${rule}|${nodeId ?? '-'}|${sensor ?? '-'}`;
    const a = this.active.get(key);
    if (!a) return;
    a.active = false;
    a.endedAt = this.now;
    this.active.delete(key);
  }

  applyAck(alertId, ack) {
    const a = this.alerts.find((x) => x.id === alertId);
    if (a) a.ack = ack;
    else this.pendingAcks.set(alertId, ack);
    this.#changed();
  }

  // ---------------------------------------------------------------- messages
  /** @param {{kind: string, nodeId: string, sensor?: string, payload: any}} m */
  ingest(m) {
    const { kind, nodeId, payload } = m;
    if (!payload || payload.v !== SCHEMA_VERSION) return false;
    const def = NODE_BY_ID.get(nodeId);
    if (!def) {
      this.#raise('unknown_node', nodeId, null, 'warning', { title: 'Node inconnu du registre', detail: `messages reçus de ${nodeId}` });
      this.#changed();
      return false;
    }
    const st = this.nodes.get(nodeId);
    if (kind === 'status') return this.#onStatus(def, st, payload);

    if (payload.seq != null) {
      const k = `${nodeId}:${payload.seq}`;
      if (this.seen.has(k)) return false; // doublon QoS 1 ou message retenu deja traite
      this.seen.add(k);
      if (this.seen.size > SEEN_MEMORY) this.seen.delete(this.seen.values().next().value);
    }
    if (Number.isFinite(payload.gwTs)) this.now = Math.max(this.now, payload.gwTs);
    if (kind === 'boot' || !st.lastSeen) st.awakeSince = payload.gwTs ?? this.now;
    st.lastSeen = Math.max(st.lastSeen, payload.gwTs ?? 0);
    this.#resolve('node_silent', nodeId);
    this.#checkClock(def, payload);

    if (kind === 'reading') this.#onReading(def, st, payload);
    else if (kind === 'door') this.#onDoor(def, st, payload);
    else if (kind === 'heartbeat') this.#onHeartbeat(def, st, payload);
    else if (kind === 'boot') this.#raise('node_boot', nodeId, null, 'info', { title: 'Redémarrage du node', detail: `raison : ${payload.reason}`, startedAt: payload.gwTs, event: true });
    else if (kind === 'ack') this.#onAck(def, payload);
    this.#changed();
    return true;
  }

  #onStatus(def, st, p) {
    st.online = p.online === true;
    st.offlineReason = p.online ? null : p.reason ?? 'inconnue';
    if (p.online) {
      st.awakeSince = this.now;
      this.#resolve('node_offline', def.id);
    }
    else {
      const detail = p.reason === 'lwt' ? 'connexion perdue (Last Will publié par le broker)' : `arrêt (${p.reason})`;
      this.#raise('node_offline', def.id, null, def.kind === 'door' ? 'warning' : 'critical', { title: 'Node hors ligne', detail });
    }
    this.#checkZones();
    this.#changed();
    return true;
  }

  #checkClock(def, p) {
    if (!Number.isFinite(p.ts) || !Number.isFinite(p.gwTs)) return;
    const st = this.nodes.get(def.id);
    if (p.ts < CLOCK_SANE_AFTER) {
      st.clockOffsetMs = null;
      this.#raise('clock_unsynced', def.id, null, 'info', { title: 'Horloge du node non synchronisée', detail: `horodatage device ${new Date(p.ts).toISOString()} : heure passerelle utilisée` });
      return;
    }
    this.#resolve('clock_unsynced', def.id);
    st.clockOffsetMs = p.ts - p.gwTs;
    if (Math.abs(st.clockOffsetMs) > CLOCK_DRIFT_MAX_MS) {
      this.#raise('clock_drift', def.id, null, 'warning', { title: "Dérive d'horloge", detail: `écart ${Math.round(st.clockOffsetMs / 1000)} s avec la passerelle (NTP ?)`, value: st.clockOffsetMs });
    } else {
      this.#resolve('clock_drift', def.id);
    }
  }

  #onReading(def, st, p) {
    const { sensor, value, gwTs } = p;
    st.sensorSeen[sensor] = gwTs;
    this.#resolve('sensor_silent', def.id, sensor);
    const ab = aberration(sensor, value, gwTs, st.lastValid[sensor]);
    if (ab) {
      st.validStreak[sensor] = 0;
      this.#raise('sensor_fault', def.id, sensor, ab.severity, { title: `Valeur aberrante · ${SENSOR_LABEL[sensor]}`, detail: ab.label, value, startedAt: gwTs });
      return;
    }
    st.validStreak[sensor] = (st.validStreak[sensor] ?? 0) + 1;
    if (st.validStreak[sensor] >= FAULT_CLEAR_READINGS) this.#resolve('sensor_fault', def.id, sensor);
    st.lastValid[sensor] = { value, gwTs };

    const hour = siteHour(gwTs);
    if (sensor === 'light') {
      const anomaly = lightAnomaly(def, value, hour);
      this.#debounced(def, st, sensor, 'light_anomaly', anomaly ? 'warning' : 'ok', gwTs, () => ({
        title: anomaly.side === 'low' ? 'Éclairage insuffisant' : 'Éclairage allumé la nuit', detail: anomaly.label, value,
      }));
      return;
    }
    const range = expectedRange(def, sensor, hour);
    const c = classify(value, range);
    const isActive = this.active.has(`threshold|${def.id}|${sensor}`);
    const level = c.level === 'ok' && isActive && nearEdge(value, range.warn) ? 'hold' : c.level;
    if (level === 'hold') return;
    this.#debounced(def, st, sensor, 'threshold', level, gwTs, () => {
      const r = c.level === 'critical' ? range.crit : range.warn;
      return {
        title: `${SENSOR_LABEL[sensor]} ${c.side === 'high' ? 'trop chaud' : 'trop froid'}`,
        detail: `${value} °C, plage ${c.level === 'critical' ? 'critique' : 'tolérée'} ${fmtRange(r)} (${range.phase})`,
        value,
      };
    });
  }

  #debounced(def, st, sensor, rule, level, gwTs, describe) {
    const k = `${rule}:${sensor}`;
    if (level === 'ok') {
      st.outCount[k] = 0;
      st.firstOut[k] = null;
      this.#resolve(rule, def.id, sensor);
      return;
    }
    st.outCount[k] = (st.outCount[k] ?? 0) + 1;
    st.firstOut[k] ??= gwTs;
    if (st.outCount[k] >= DEBOUNCE_READINGS) {
      this.#raise(rule, def.id, sensor, level, { ...describe(), startedAt: st.firstOut[k] });
    }
  }

  #onDoor(def, st, p) {
    const open = p.state === 'open';
    if (open && !st.door.open) st.door = { open: true, since: p.gwTs };
    if (!open) {
      st.door = { open: false, since: null };
      this.#resolve('door_open_long', def.id);
      this.#resolve('door_offhours', def.id);
      return;
    }
    const h = siteHour(p.gwTs);
    if (h < OPENING_HOURS[0] || h >= OPENING_HOURS[1]) {
      this.#raise('door_offhours', def.id, null, 'critical', { title: 'Ouverture hors horaires', detail: `${def.label} ouverte à ${fmtHour(h)}`, startedAt: p.gwTs });
    }
  }

  #onHeartbeat(def, st, p) {
    Object.assign(st, { rssi: p.rssi ?? null, fw: p.fw ?? null, uptimeS: p.uptimeS ?? null });
    if (p.battery === undefined) return;
    st.battery = p.battery;
    if (p.battery < BATTERY_WARN) {
      const sev = p.battery < BATTERY_CRIT ? 'critical' : 'warning';
      this.#raise('battery_low', def.id, null, sev, { title: 'Pile faible', detail: `${p.battery} % restant`, value: p.battery });
    } else if (p.battery >= BATTERY_CLEAR) {
      this.#resolve('battery_low', def.id);
    }
  }

  #onAck(def, p) {
    if (p.detail === 'applied_but_relay_feedback_on') {
      this.#raise('relay_stuck', def.id, null, 'critical', { title: 'Relais de lampe bloqué', detail: 'commande « lampe off » appliquée mais le relais reste fermé : couper le chauffage (coupure sécurité)', startedAt: p.gwTs });
    } else if (p.action === 'lamp' && p.ok && p.detail === 'ok') {
      this.#resolve('relay_stuck', def.id);
    }
  }

  /** Periode demandee par commande (ack ok) : ajuste la detection de silence. */
  setExpectedPeriod(nodeId, seconds) {
    const st = this.nodes.get(nodeId);
    if (st) st.periodS = seconds;
  }

  // ---------------------------------------------------------------- regles temporelles
  tick(now = this.now) {
    this.now = Math.max(this.now, now);
    if (!this.now) return;
    for (const def of NODES) this.#checkTimers(def, this.nodes.get(def.id));
    this.#checkZones();
    this.#changed();
  }

  #checkTimers(def, st) {
    if (!st.lastSeen) return;
    const expected = st.periodS ?? def.period;
    const limitS = expected ? Math.max(3 * expected, MIN_SILENCE_S) : 2.2 * def.heartbeat;
    const silentFor = (this.now - st.lastSeen) / 1000;
    if (silentFor > limitS) {
      this.#raise('node_silent', def.id, null, def.kind === 'door' ? 'warning' : 'critical', {
        title: 'Node muet', detail: `aucun message depuis ${Math.round(silentFor / 60)} min (seuil ${Math.round(limitS / 60)} min)`, startedAt: st.lastSeen,
      });
    } else {
      for (const s of def.sensors) {
        const last = Math.max(st.sensorSeen[s] ?? 0, st.awakeSince);
        if (st.sensorSeen[s] && st.online !== false && (this.now - last) / 1000 > limitS) {
          this.#raise('sensor_silent', def.id, s, 'warning', { title: `Capteur muet · ${SENSOR_LABEL[s]}`, detail: 'le node émet mais plus ce capteur', startedAt: last });
        }
      }
    }
    if (st.door.open && st.door.since) {
      const [warnS, critS] = DOOR_LIMITS[def.kind];
      const openS = (this.now - st.door.since) / 1000;
      if (openS > warnS) {
        this.#raise('door_open_long', def.id, null, openS > critS ? 'critical' : 'warning', {
          title: 'Porte ouverte trop longtemps', detail: `ouverte depuis ${Math.round(openS / 60)} min (tolérance ${warnS / 60} min)`, startedAt: st.door.since,
        });
      }
    }
  }

  #checkZones() {
    for (const z of ZONES) {
      const mains = NODES.filter((n) => n.zone === z.id && n.power === 'mains');
      const down = mains.filter((n) => this.nodes.get(n.id).online === false || this.active.has(`node_silent|${n.id}|-`));
      if (down.length >= ZONE_DOWN_MIN_NODES && down.length >= mains.length / 2) {
        this.#raise('zone_down', null, z.id, 'critical', { title: `Coupure probable · ${z.label}`, detail: `${down.length}/${mains.length} nodes secteur injoignables simultanément` });
      } else {
        this.#resolve('zone_down', null, z.id);
      }
    }
  }

  // ---------------------------------------------------------------- persistance navigateur
  serialize() {
    return { now: this.now, alerts: this.alerts.slice(0, 200), nodes: [...this.nodes.entries()] };
  }

  restore(data) {
    if (!data || !Array.isArray(data.alerts) || !Array.isArray(data.nodes)) return;
    this.now = Number(data.now) || 0;
    this.alerts = data.alerts;
    this.active = new Map(this.alerts.filter((a) => a.active).map((a) => [a.key, a]));
    for (const [id, st] of data.nodes) if (this.nodes.has(id)) this.nodes.set(id, { ...emptyState(), ...st });
  }
}

const nearEdge = (v, r) => Boolean(r) && (v < r[0] + HYSTERESIS_C || v > r[1] - HYSTERESIS_C);
const fmtRange = (r) => (r ? `[${Number.isFinite(r[0]) ? r[0] : '–'} ; ${r[1]}]` : '');
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
