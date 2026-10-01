'use strict';

const { EventEmitter } = require('node:events');
const { createRng } = require('./prng');
const species = require('./species');
const facility = require('./facility');
const { buildScenario } = require('./scenarios');

const FW = '1.4.2';
const STEP_S = 5; // pas d'integration du modele thermique (secondes simulees)

const q16 = (v) => Math.round(v * 16) / 16; // resolution 12 bits type DS18B20
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hourOf = (ms) => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

class Simulator extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.seed       graine aleatoire
   * @param {number} opts.speed      facteur d'acceleration du temps (60 = 1 s reelle -> 1 min simulee)
   * @param {number} opts.start      date de depart (ms epoch, heure locale de la machine)
   * @param {string} opts.scenario   normal | incidents | chaos
   */
  constructor(opts = {}) {
    super();
    this.seed = opts.seed ?? 42;
    this.speed = opts.speed ?? 60;
    this.rng = createRng(this.seed);
    this.now = opts.start ?? Simulator.defaultStart();
    this.startedAt = this.now;
    this.seq = 0;
    this.nodes = new Map();
    this.enclosures = new Map();
    this.rooms = new Map();
    this.agenda = [];
    this.lastPlannedDay = null;
    this.timer = null;
    this.weather = { cloud: 0.3 };

    this.#buildWorld();
    this.scenario = buildScenario(opts.scenario ?? 'incidents', this);
  }

  static defaultStart() {
    const d = new Date();
    d.setHours(7, 45, 0, 0);
    return d.getTime();
  }

  // ------------------------------------------------------------------ monde
  #buildWorld() {
    for (const r of facility.rooms) {
      this.rooms.set(r.id, {
        ...r,
        lightsOn: false,
        powerCut: false,
        temp: r.ambient ?? 18,
      });
      if (r.ambient !== null) {
        this.#addNode(`N-ROOM-${r.id}`, { kind: 'room', room: r.id, power: 'mains', period: 60 });
      }
    }

    for (const e of facility.enclosures) {
      const prof = species[e.species];
      const room = this.rooms.get(e.room);
      const base = room.ambient ?? 18;
      this.enclosures.set(e.id, {
        ...e,
        prof,
        tHot: base + this.rng.range(0, 1),
        tCold: base + this.rng.range(0, 1),
        lampOn: false,
        heaterOn: false,
        lightOn: false,
        lampMode: 'auto',
        lightMode: 'auto',
        safetyCut: false,
        setpoint: prof.hotDay,
        doorOpen: false,
        faults: new Set(),
      });
      this.#addNode(`N-${e.id}`, {
        kind: e.room === 'EXT' ? 'outdoor' : 'enclosure',
        room: e.room,
        enclosure: e.id,
        power: e.power,
        period: e.power === 'battery' ? 300 : 30,
      });
    }

    for (const d of facility.buildingDoors) {
      this.#addNode(`N-${d.id}`, { kind: 'door', door: d.id, power: d.power, period: null, doorOpen: false });
    }
  }

  #addNode(id, props) {
    const room = props.room ? this.rooms.get(props.room) : null;
    const baseRssi = room ? -38 - room.distanceToGatewayM * 1.1 : -55;
    this.nodes.set(id, {
      id,
      fw: FW,
      online: true,
      bootAt: this.now - this.rng.int(3600, 30 * 86400) * 1000,
      clockSynced: true,
      clockOffsetMs: 0,
      clockDriftMsPerMin: 0,
      nextReading: this.now + this.rng.int(0, 20) * 1000,
      nextHeartbeat: this.now + this.rng.int(0, 120) * 1000,
      heartbeatPeriod: props.power === 'battery' ? 1800 : 300,
      battery: props.power === 'battery' ? this.rng.range(55, 98) : null,
      baseRssi,
      offlineUntil: null,
      probeFault: null, // { sensor, mode: 'disconnected' | 'por' }
      ...props,
    });
  }

  // ------------------------------------------------------------------ boucle
  start(tickRealMs = 1000) {
    if (this.timer) return;
    this.emitAllBoots();
    this.timer = setInterval(() => this.advance((tickRealMs / 1000) * this.speed), tickRealMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  emitAllBoots() {
    for (const n of this.nodes.values()) {
      this.#out(n, { type: 'heartbeat', uptimeS: Math.round((this.now - n.bootAt) / 1000), ...this.#radio(n) });
    }
  }

  /** Avance la simulation de `seconds` secondes simulees. */
  advance(seconds) {
    const end = this.now + seconds * 1000;
    while (this.now < end) {
      const step = Math.min(STEP_S * 1000, end - this.now);
      this.now += step;
      this.#planDayIfNeeded();
      this.#runAgenda();
      this.scenario.tick(this.now);
      this.#physics(step / 1000);
      this.#reports();
    }
  }

  // ------------------------------------------------------------------ agenda soigneurs
  #planDayIfNeeded() {
    const day = new Date(this.now).toDateString();
    if (day === this.lastPlannedDay) return;
    this.lastPlannedDay = day;
    const d0 = new Date(this.now);
    d0.setHours(0, 0, 0, 0);
    const at = (h, m, jitterMin = 0) =>
      d0.getTime() + ((h * 60 + m + this.rng.int(-jitterMin, jitterMin)) * 60 + this.rng.int(0, 59)) * 1000;

    const arrival = at(8, 10, 8);
    this.#schedule(arrival, () => this.#pulseDoor('N-DOOR-MAIN', 6));
    this.#schedule(arrival + 40_000, () => this.#pulseDoor('N-DOOR-SAS', 9));

    const tour = [
      ['DES', 8, 30], ['TRO', 9, 5], ['SOI', 9, 40], ['QUA', 10, 15], ['EXT', 10, 50],
    ];
    for (const [roomId, h, m] of tour) this.#scheduleRoomVisit(roomId, at(h, m, 6), true);

    const isFeedingDay = [1, 3, 5].includes(d0.getDay());
    if (isFeedingDay) {
      const t = at(14, 0, 20);
      this.#schedule(t, () => this.#pulseDoor('N-DOOR-FEED', this.rng.int(40, 150)));
      this.#scheduleRoomVisit('DES', t + 10 * 60_000, true);
      this.#scheduleRoomVisit('TRO', t + 35 * 60_000, true);
    }

    for (const [roomId, h, m] of [['SOI', 12, 15], ['SOI', 16, 30], ['QUA', 17, 10]]) {
      this.#scheduleRoomVisit(roomId, at(h, m, 10), false);
    }
    const leave = at(18, 35, 15);
    this.#schedule(leave, () => this.#pulseDoor('N-DOOR-SAS', 7));
    this.#schedule(leave + 30_000, () => this.#pulseDoor('N-DOOR-MAIN', 5));
    this.agenda.sort((a, b) => a.t - b.t);
  }

  #scheduleRoomVisit(roomId, t, openEnclosures) {
    const room = this.rooms.get(roomId);
    const roomNode = this.nodes.get(`N-ROOM-${roomId}`);
    if (roomNode) this.#schedule(t, () => this.#pulseDoor(roomNode.id, this.rng.int(4, 10)));
    this.#schedule(t + 15_000, () => { room.lightsOn = roomId !== 'EXT'; });
    let cursor = t + 60_000;
    const list = [...this.enclosures.values()].filter((e) => e.room === roomId);
    for (const e of list) {
      if (!openEnclosures && !this.rng.chance(0.3)) continue;
      const dur = this.rng.int(30, roomId === 'EXT' ? 600 : 240);
      this.#schedule(cursor, () => this.#setEnclosureDoor(e.id, true));
      this.#schedule(cursor + dur * 1000, () => this.#setEnclosureDoor(e.id, false));
      cursor += (dur + this.rng.int(20, 90)) * 1000;
    }
    this.#schedule(cursor + 60_000, () => { room.lightsOn = false; });
    if (roomNode) this.#schedule(cursor + 70_000, () => this.#pulseDoor(roomNode.id, this.rng.int(3, 8)));
  }

  #schedule(t, fn) {
    this.agenda.push({ t, fn });
  }

  #runAgenda() {
    this.agenda.sort((a, b) => a.t - b.t);
    while (this.agenda.length && this.agenda[0].t <= this.now) this.agenda.shift().fn();
  }

  // ------------------------------------------------------------------ portes
  #pulseDoor(nodeId, seconds) {
    this.#setDoor(nodeId, true);
    this.#schedule(this.now + seconds * 1000, () => this.#setDoor(nodeId, false));
  }

  #setEnclosureDoor(encId, open) {
    const e = this.enclosures.get(encId);
    if (e.faults.has('door_stuck_open') && !open) return; // porte mal refermee
    e.doorOpen = open;
    this.#setDoor(`N-${encId}`, open);
  }

  #setDoor(nodeId, open) {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    if (n.kind === 'door' || n.kind === 'room') n.doorOpen = open;
    if (!this.#isUp(n)) return; // l'evenement est perdu si le node est hors ligne
    this.#out(n, { type: 'door', state: open ? 'open' : 'closed' });
  }

  // ------------------------------------------------------------------ physique
  #physics(dt) {
    const h = hourOf(this.now);
    this.#weather(dt, h);

    for (const room of this.rooms.values()) {
      if (room.ambient === null) {
        room.temp = this.outdoorAir(h);
        continue;
      }
      const target = room.powerCut ? room.ambient - 6 : room.ambient + Math.sin(((h - 9) / 24) * 2 * Math.PI) * 1.2;
      room.temp += (target - room.temp) * (1 - Math.exp(-dt / 3600));
    }

    for (const e of this.enclosures.values()) {
      const room = this.rooms.get(e.room);
      if (e.room === 'EXT') {
        this.#outdoorEnclosure(e, dt, h);
        continue;
      }
      const p = e.prof;
      const isDay = h >= p.photo[0] && h < p.photo[1];
      const powered = !room.powerCut && !e.safetyCut;

      // Thermostat embarque (logique du terrarium, pas celle de vos nodes)
      if (e.lampMode === 'auto') {
        if (isDay) {
          if (e.tHot < e.setpoint - 0.8) e.lampOn = true;
          else if (e.tHot > e.setpoint + 0.3) e.lampOn = false;
        } else e.lampOn = false;
      } else e.lampOn = e.lampMode === 'on';
      if (e.faults.has('thermostat_stuck')) e.lampOn = true;

      if (!isDay) {
        if (e.tCold < p.night[0] + 1) e.heaterOn = true;
        else if (e.tCold > p.night[0] + 2.5) e.heaterOn = false;
      } else e.heaterOn = false;

      e.lightOn = e.lightMode === 'auto' ? isDay : e.lightMode === 'on';

      const lampWorks = powered && e.lampOn && !e.faults.has('lamp_failure');
      const gain = e.faults.has('thermostat_stuck') ? 1.9 : 1.15;
      let eqHot = room.temp;
      if (lampWorks) eqHot = room.temp + (p.hotDay - room.temp) * gain;
      else if (powered && e.heaterOn) eqHot = room.temp + 4.5;
      let tau = 650;
      if (e.doorOpen) {
        eqHot = room.temp + (eqHot - room.temp) * 0.45;
        tau = 260;
      }
      e.tHot += (eqHot - e.tHot) * (1 - Math.exp(-dt / tau));
      const eqCold = room.temp + (e.tHot - room.temp) * 0.28 + (powered && e.heaterOn ? 1.2 : 0);
      e.tCold += (eqCold - e.tCold) * (1 - Math.exp(-dt / (e.doorOpen ? 400 : 1300)));
    }

    for (const n of this.nodes.values()) {
      if (n.battery !== null) {
        const drain = n.fastDrain ? 0.02 : 0.00004;
        n.battery = clamp(n.battery - drain * dt, 0, 100);
        if (n.battery <= 0.5 && n.online) {
          n.online = false; // pile vide : le node s'eteint sans prevenir
        }
      }
      if (!n.clockSynced && this.now - n.bootAt > 120_000) {
        n.clockSynced = true; // synchro NTP obtenue 2 min apres le boot
      }
      n.clockOffsetMs += n.clockDriftMsPerMin * (dt / 60);
      if (n.offlineUntil && this.now >= n.offlineUntil) {
        n.offlineUntil = null;
        this.#boot(n, 'watchdog');
      }
    }
  }

  #weather(dt, h) {
    // Nebulosite : marche aleatoire bornee
    this.weather.cloud = clamp(this.weather.cloud + this.rng.gauss(0, 0.004) * Math.sqrt(dt), 0, 1);
    this.weather.hour = h;
  }

  outdoorAir(h) {
    // Fin septembre, sud de la France : 12 degC la nuit, 24 degC en milieu d'apres-midi
    const base = 18 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI);
    return base - this.weather.cloud * 2.5;
  }

  sunLux(h) {
    if (h < 7.4 || h > 19.6) return 0.3;
    const elev = Math.max(0, Math.sin(((h - 7.4) / 12.2) * Math.PI));
    return 85000 * elev ** 1.6 * (1 - 0.75 * this.weather.cloud) + 50;
  }

  #outdoorEnclosure(e, dt, h) {
    const air = this.outdoorAir(h);
    const sun = this.sunLux(h) / 85000;
    const eqHot = air + sun * 16; // pierre exposee
    const eqCold = air - 1 + sun * 3; // abri
    e.tHot += (eqHot - e.tHot) * (1 - Math.exp(-dt / 900));
    e.tCold += (eqCold - e.tCold) * (1 - Math.exp(-dt / 1800));
  }

  // ------------------------------------------------------------------ mesures
  #reports() {
    for (const n of this.nodes.values()) {
      if (!this.#isUp(n)) continue;
      if (n.period && this.now >= n.nextReading) {
        n.nextReading = this.now + n.period * 1000;
        this.#emitReadings(n);
      }
      if (this.now >= n.nextHeartbeat) {
        n.nextHeartbeat = this.now + n.heartbeatPeriod * 1000;
        this.#out(n, {
          type: 'heartbeat',
          uptimeS: Math.round((this.now - n.bootAt) / 1000),
          ...this.#radio(n),
        });
      }
    }
  }

  #emitReadings(n) {
    if (n.kind === 'room') {
      const room = this.rooms.get(n.room);
      this.#out(n, { type: 'reading', sensor: 'temp_ambient', value: this.#probe(n, 'temp_ambient', room.temp), unit: 'C' });
      return;
    }
    const e = this.enclosures.get(n.enclosure);
    const room = this.rooms.get(e.room);
    this.#out(n, { type: 'reading', sensor: 'temp_hot', value: this.#probe(n, 'temp_hot', e.tHot), unit: 'C' });
    this.#out(n, { type: 'reading', sensor: 'temp_cold', value: this.#probe(n, 'temp_cold', e.tCold), unit: 'C' });
    this.#out(n, { type: 'reading', sensor: 'light', value: this.#lux(e, room), unit: 'lx' });
  }

  #probe(n, sensor, trueValue) {
    const f = n.probeFault;
    if (f && f.sensor === sensor) {
      if (f.mode === 'disconnected') return -127;
      if (f.mode === 'por' && this.rng.chance(0.35)) return 85;
    }
    return q16(trueValue + this.rng.gauss(0, 0.08));
  }

  #lux(e, room) {
    const h = hourOf(this.now);
    if (e.room === 'EXT') return Math.round(Math.max(0, this.sunLux(h) * this.rng.range(0.93, 1.05)));
    const p = e.prof;
    let lux = 0.5;
    const powered = !room.powerCut && !e.safetyCut;
    if (powered && e.lightOn) {
      const ramp = Math.min(1, (h - p.photo[0]) * 3, (p.photo[1] - h) * 3);
      const k = e.lightMode === 'auto' ? clamp(ramp, 0.05, 1) : 1;
      lux += p.luxDay * k * (e.faults.has('lamp_failure') ? 0.12 : 1);
    }
    if (room.lightsOn && !room.powerCut) lux += 180;
    if (e.doorOpen) lux += 60;
    return Math.round(Math.max(0, lux * this.rng.range(0.96, 1.04)));
  }

  #radio(n) {
    const r = { rssi: Math.round(n.baseRssi + this.rng.gauss(0, 3)), fw: n.fw };
    if (n.battery !== null) r.battery = Math.round(n.battery);
    return r;
  }

  // ------------------------------------------------------------------ etat des nodes
  #isUp(n) {
    if (!n.online || n.offlineUntil) return false;
    const room = n.room ? this.rooms.get(n.room) : null;
    if (room && room.powerCut && n.power === 'mains') return false;
    return true;
  }

  #boot(n, reason) {
    n.bootAt = this.now;
    n.clockSynced = false;
    n.clockOffsetMs = 0;
    n.nextReading = this.now + 3000;
    this.#out(n, { type: 'boot', reason, ...this.#radio(n) });
  }

  setOffline(nodeId, seconds) {
    const n = this.nodes.get(nodeId);
    if (n) n.offlineUntil = this.now + seconds * 1000;
  }

  setRoomPower(roomId, on) {
    const room = this.rooms.get(roomId);
    const wasCut = room.powerCut;
    room.powerCut = !on;
    if (wasCut && on) {
      for (const n of this.nodes.values()) {
        if (n.room === roomId && n.power === 'mains') this.#boot(n, 'power_on');
      }
    }
  }

  openEnclosureDoor(encId, open) {
    this.#setEnclosureDoor(encId, open);
  }

  pulseBuildingDoor(nodeId, seconds) {
    this.#pulseDoor(nodeId, seconds);
  }

  // ------------------------------------------------------------------ commandes
  /**
   * Traite une commande a destination d'un node.
   * cmd = { id, target, action, value }
   * Retourne l'ack emis, ou null si le node est inconnu / injoignable (comme un vrai device).
   */
  handleCommand(cmd) {
    const n = this.nodes.get(cmd?.target);
    if (!n || !this.#isUp(n)) return null;
    const e = n.enclosure ? this.enclosures.get(n.enclosure) : null;
    let ok = true;
    let detail = 'ok';
    switch (cmd.action) {
      case 'lamp':
      case 'light': {
        if (!e || n.kind !== 'enclosure') { ok = false; detail = 'not_supported'; break; }
        if (!['on', 'off', 'auto'].includes(cmd.value)) { ok = false; detail = 'bad_value'; break; }
        e[cmd.action === 'lamp' ? 'lampMode' : 'lightMode'] = cmd.value;
        if (cmd.action === 'lamp' && e.faults.has('thermostat_stuck') && cmd.value === 'off') {
          detail = 'applied_but_relay_feedback_on'; // le relais est colle : la commande ne change rien
        }
        break;
      }
      case 'setpoint': {
        const v = Number(cmd.value);
        if (!e || n.kind !== 'enclosure' || !Number.isFinite(v) || v < 20 || v > 50) { ok = false; detail = 'bad_value'; break; }
        e.setpoint = v;
        break;
      }
      case 'safety_cut': {
        if (!e || n.kind !== 'enclosure') { ok = false; detail = 'not_supported'; break; }
        e.safetyCut = cmd.value === true || cmd.value === 'on';
        break;
      }
      case 'interval': {
        const v = Number(cmd.value);
        if (!n.period || !Number.isFinite(v) || v < 5 || v > 3600) { ok = false; detail = 'bad_value'; break; }
        n.period = v;
        break;
      }
      case 'reboot': {
        this.#ack(n, cmd, true, 'rebooting');
        n.offlineUntil = this.now + 20_000;
        return { rebooting: true };
      }
      case 'identify':
        detail = 'led_blink_10s';
        break;
      default:
        ok = false;
        detail = 'unknown_action';
    }
    return this.#ack(n, cmd, ok, detail);
  }

  #ack(n, cmd, ok, detail) {
    return this.#out(n, { type: 'ack', cmdId: cmd.id ?? null, action: cmd.action, ok, detail });
  }

  // ------------------------------------------------------------------ sortie
  #deviceTs(n) {
    // Un node sans synchro NTP ne connait que son uptime : son horodatage part de 0 (1970).
    if (!n.clockSynced) return this.now - n.bootAt;
    return Math.round(this.now + n.clockOffsetMs);
  }

  #out(n, payload) {
    const msg = { node: n.id, ts: this.#deviceTs(n), seq: ++this.seq, ...payload };
    this.emit('message', msg);
    return msg;
  }

  /** Photo de l'etat reel (verite terrain), utile pour deboguer. Un vrai systeme n'a pas acces a ceci. */
  snapshot() {
    return {
      simTime: new Date(this.now).toISOString(),
      rooms: [...this.rooms.values()].map((r) => ({ id: r.id, temp: +r.temp.toFixed(2), lightsOn: r.lightsOn, powerCut: r.powerCut })),
      enclosures: [...this.enclosures.values()].map((e) => ({
        id: e.id,
        species: e.species,
        tHot: +e.tHot.toFixed(2),
        tCold: +e.tCold.toFixed(2),
        lampOn: e.lampOn,
        lampMode: e.lampMode,
        lightOn: e.lightOn,
        doorOpen: e.doorOpen,
        faults: [...e.faults],
      })),
    };
  }
}

module.exports = { Simulator };
