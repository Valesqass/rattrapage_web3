// Description du site vue par le front : registre des nodes, profils d'espece et seuils.
// Le front ne decouvre pas les nodes : un node inconnu du registre est signale, jamais affiche en silence.

export const SITE_TZ = 'Europe/Paris';

export const ZONES = [
  { id: 'DES', label: 'Salle désertique', ambient: 25 },
  { id: 'TRO', label: 'Salle tropicale', ambient: 27 },
  { id: 'SOI', label: 'Soins intensifs', ambient: 26 },
  { id: 'QUA', label: 'Quarantaine (annexe)', ambient: 24 },
  { id: 'EXT', label: 'Enclos extérieurs', ambient: null },
  { id: 'BLD', label: 'Portes du bâtiment', ambient: null },
];

// hotDay / coldDay / night / photo / luxDay : repris des fiches d'elevage du centre.
// stable : bac hospitalier, marges de tolerance divisees par deux.
export const SPECIES = {
  pogona: { label: 'Agame barbu', hotDay: 40, coldDay: [24, 29], night: [18, 23], photo: [7, 20], luxDay: 32000 },
  uromastyx: { label: 'Fouette-queue', hotDay: 45, coldDay: [26, 31], night: [20, 24], photo: [7, 20], luxDay: 45000 },
  eublepharis: { label: 'Gecko léopard', hotDay: 32, coldDay: [23, 27], night: [19, 23], photo: [8, 20], luxDay: 3500 },
  python: { label: 'Python royal', hotDay: 32, coldDay: [25, 28], night: [23, 26], photo: [7, 19], luxDay: 2500 },
  boa: { label: 'Boa constricteur', hotDay: 33, coldDay: [25, 28], night: [22, 25], photo: [7, 19], luxDay: 3000 },
  chameleon: { label: 'Caméléon casqué', hotDay: 33, coldDay: [22, 27], night: [16, 21], photo: [7, 19], luxDay: 18000 },
  iguana: { label: 'Iguane vert', hotDay: 37, coldDay: [26, 30], night: [22, 26], photo: [7, 19], luxDay: 22000 },
  phelsuma: { label: 'Gecko diurne', hotDay: 34, coldDay: [24, 28], night: [19, 23], photo: [7, 19], luxDay: 15000 },
  quarantine: { label: 'Arrivant non identifié', hotDay: 32, coldDay: [24, 28], night: [21, 25], photo: [8, 19], luxDay: 6000 },
  hospital: { label: 'Bac hospitalier', hotDay: 29, coldDay: [27, 29.5], night: [26, 29], photo: [8, 18], luxDay: 1200, stable: true },
  tortoise: { label: "Tortue d'Hermann", outdoor: true },
};

const ENCLOSURES = [
  ['DES-01', 'pogona'], ['DES-02', 'pogona'], ['DES-03', 'pogona'], ['DES-04', 'uromastyx'], ['DES-05', 'eublepharis'], ['DES-06', 'eublepharis'],
  ['TRO-01', 'python'], ['TRO-02', 'python'], ['TRO-03', 'boa'], ['TRO-04', 'chameleon'], ['TRO-05', 'iguana'], ['TRO-06', 'phelsuma'],
  ['SOI-01', 'hospital'], ['SOI-02', 'hospital'], ['SOI-03', 'hospital'],
  ['QUA-01', 'quarantine'], ['QUA-02', 'quarantine'], ['QUA-03', 'quarantine'], ['QUA-04', 'quarantine'],
  ['EXT-01', 'tortoise'], ['EXT-02', 'tortoise'],
];

const DOORS = [
  ['DOOR-MAIN', 'Entrée principale'],
  ['DOOR-SAS', 'Sas sanitaire'],
  ['DOOR-FEED', 'Local nourriture'],
];

// Periodes nominales d'emission (s), cf. fiche technique des nodes.
const PERIOD = { enclosure: 30, outdoor: 300, room: 60, door: null };
const HEARTBEAT = { mains: 300, battery: 1800 };

// Duree d'ouverture toleree avant alerte (s) : avertissement puis critique.
export const DOOR_LIMITS = {
  enclosure: [600, 1200],
  outdoor: [900, 1800],
  room: [300, 900],
  door: [180, 600],
};

// Plage horaire d'activite du personnel (heure locale du site).
export const OPENING_HOURS = [7, 19.5];

function buildNodes() {
  const nodes = [];
  for (const z of ZONES) {
    if (z.ambient !== null) {
      nodes.push({ id: `N-ROOM-${z.id}`, zone: z.id, kind: 'room', label: `Ambiance ${z.label}`, power: 'mains', sensors: ['temp_ambient'], ambient: z.ambient });
    }
  }
  for (const [encId, species] of ENCLOSURES) {
    const zone = encId.slice(0, 3);
    const outdoor = zone === 'EXT';
    nodes.push({
      id: `N-${encId}`,
      zone,
      kind: outdoor ? 'outdoor' : 'enclosure',
      enclosure: encId,
      species,
      label: `${encId} · ${SPECIES[species].label}`,
      power: outdoor ? 'battery' : 'mains',
      sensors: ['temp_hot', 'temp_cold', 'light'],
    });
  }
  for (const [doorId, label] of DOORS) {
    nodes.push({ id: `N-${doorId}`, zone: 'BLD', kind: 'door', label, power: 'battery', sensors: [] });
  }
  return nodes.map((n) => ({ ...n, period: PERIOD[n.kind], heartbeat: HEARTBEAT[n.power] }));
}

export const NODES = buildNodes();
export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));

export const SENSOR_LABEL = {
  temp_hot: 'Point chaud',
  temp_cold: 'Point froid',
  temp_ambient: 'Ambiance',
  light: 'Lumière',
};

/** Heure locale du site (decimale) pour un horodatage passerelle. */
export function siteHour(ts) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: SITE_TZ, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ts));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
}
