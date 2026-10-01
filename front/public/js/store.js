// Memoire du front : dernieres valeurs, series des 30 dernieres minutes (heure passerelle) et
// persistance dans le navigateur pour qu'un rechargement ne vide pas les courbes.

const WINDOW_MS = 30 * 60_000;
const MAX_POINTS = 600;
const STORAGE_KEY = 'rc.state.v1';

export class Store {
  constructor() {
    this.series = new Map(); // `${node}|${sensor}` -> [[gwTs, value|null]]
    this.latest = new Map(); // `${node}|${sensor}` -> { value, gwTs, valid }
    this.doors = new Map(); // node -> [{ gwTs, state }]
    this.gateway = { online: null, gwTs: 0, speed: null, scenario: null };
  }

  addReading(nodeId, sensor, gwTs, value, valid, now) {
    const key = `${nodeId}|${sensor}`;
    this.latest.set(key, { value, gwTs, valid });
    const s = this.series.get(key) ?? [];
    const point = [gwTs, valid ? value : null];
    // Insertion ordonnee : les messages tamponnes pendant une coupure arrivent en retard.
    if (!s.length || s[s.length - 1][0] <= gwTs) s.push(point);
    else s.splice(s.findIndex((p) => p[0] > gwTs), 0, point);
    this.series.set(key, prune(s, now));
  }

  addDoor(nodeId, gwTs, state) {
    const list = this.doors.get(nodeId) ?? [];
    this.doors.set(nodeId, [{ gwTs, state }, ...list].slice(0, 20));
  }

  window(nodeId, sensor, now) {
    return prune(this.series.get(`${nodeId}|${sensor}`) ?? [], now);
  }

  value(nodeId, sensor) {
    return this.latest.get(`${nodeId}|${sensor}`);
  }

  save(engine) {
    try {
      const data = { series: [...this.series], latest: [...this.latest], doors: [...this.doors], engine: engine.serialize() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[store] sauvegarde locale impossible', err);
    }
  }

  load(engine) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.series = new Map(data.series ?? []);
      this.latest = new Map(data.latest ?? []);
      this.doors = new Map(data.doors ?? []);
      engine.restore(data.engine);
    } catch (err) {
      console.warn('[store] etat local illisible, ignore', err);
    }
  }

  static clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* stockage indisponible (navigation privee) : rien a effacer */
    }
  }
}

function prune(s, now) {
  if (!now) return s.slice(-MAX_POINTS);
  const from = now - WINDOW_MS;
  const i = s.findIndex((p) => p[0] >= from);
  return (i === -1 ? [] : s.slice(i)).slice(-MAX_POINTS);
}
