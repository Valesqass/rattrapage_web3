// Regles d'evaluation pures (sans etat) : seuils par espece et detection de valeurs aberrantes.

import { SPECIES } from './site.js';

// Codes d'erreur du DS18B20 : -127 = sonde absente, 85 = valeur de mise sous tension (reset).
export const DS18B20_DISCONNECTED = -127;
export const DS18B20_POWER_ON_RESET = 85;

const TEMP_PLAUSIBLE = [0, 60];
const LIGHT_PLAUSIBLE = [0, 120000];
const MAX_TEMP_JUMP_C = 4;
const MAX_JUMP_WINDOW_MS = 90_000;
const RAMP_GRACE_H = 1; // allumage / extinction des lampes : la temperature est en transition
const NIGHT_HEAT_MAT_C = 1.5;

/**
 * Valeur physiquement impossible ou code d'erreur capteur.
 * @param {{value: number, gwTs: number} | undefined} previous derniere valeur valide du meme capteur
 * @returns {null | {reason: string, label: string, severity: 'warning'|'critical'}}
 */
export function aberration(sensor, value, gwTs, previous) {
  if (!Number.isFinite(value)) return { reason: 'nan', label: 'valeur non numérique', severity: 'warning' };
  if (sensor === 'light') {
    return value < LIGHT_PLAUSIBLE[0] || value > LIGHT_PLAUSIBLE[1] ? { reason: 'range', label: `${value} lx hors plage capteur`, severity: 'warning' } : null;
  }
  if (value === DS18B20_DISCONNECTED) return { reason: 'disconnected', label: 'sonde déconnectée (-127 °C)', severity: 'critical' };
  if (value === DS18B20_POWER_ON_RESET) return { reason: 'por', label: 'reset de sonde (85 °C)', severity: 'warning' };
  if (value < TEMP_PLAUSIBLE[0] || value > TEMP_PLAUSIBLE[1]) return { reason: 'range', label: `${value} °C physiquement impossible`, severity: 'warning' };
  if (previous && gwTs - previous.gwTs <= MAX_JUMP_WINDOW_MS && Math.abs(value - previous.value) > MAX_TEMP_JUMP_C) {
    return { reason: 'jump', label: `saut de ${(value - previous.value).toFixed(1)} °C entre deux mesures`, severity: 'warning' };
  }
  return null;
}

const widen = ([lo, hi], d) => [lo - d, hi + d];

/**
 * Plages attendues pour un capteur a une heure donnee (heure locale du site).
 * @returns {null | {phase: string, warn: [number, number] | null, crit: [number, number] | null}}
 */
export function expectedRange(node, sensor, hour) {
  if (sensor === 'temp_ambient') {
    return { phase: 'ambiance', warn: widen([node.ambient, node.ambient], 3), crit: widen([node.ambient, node.ambient], 6) };
  }
  const p = SPECIES[node.species];
  if (!p || sensor === 'light') return null;
  if (p.outdoor) return { phase: 'extérieur', warn: [5, 42], crit: [2, 48] };

  const k = p.stable ? 0.5 : 1;
  const [on, off] = p.photo;
  const inRamp = (hour >= on && hour < on + RAMP_GRACE_H) || (hour >= off && hour < off + RAMP_GRACE_H);
  const isDay = hour >= on && hour < off;

  if (inRamp) {
    // Transition : seule une surchauffe franche est anormale.
    return { phase: 'transition', warn: null, crit: [-Infinity, p.hotDay + 6 * k] };
  }
  if (isDay && sensor === 'temp_hot') {
    return { phase: 'jour', warn: [p.hotDay - 5 * k, p.hotDay + 3 * k], crit: [p.hotDay - 10 * k, p.hotDay + 6 * k] };
  }
  if (isDay) return { phase: 'jour', warn: widen(p.coldDay, 2 * k), crit: widen(p.coldDay, 4 * k) };
  // Nuit : le danger principal est le froid (panne du tapis chauffant). Cote chaud, la marge est plus
  // large, et plus encore au point chaud, maintenu par le tapis de nuit.
  const hotBonus = sensor === 'temp_hot' ? NIGHT_HEAT_MAT_C : 0;
  const [n0, n1] = p.night;
  return { phase: 'nuit', warn: [n0 - 2 * k, n1 + (3 + hotBonus) * k], crit: [n0 - 5 * k, n1 + (6 + hotBonus) * k] };
}

/** @returns {{level: 'ok'|'warning'|'critical', side: 'low'|'high'|null}} */
export function classify(value, range) {
  if (!range) return { level: 'ok', side: null };
  const outside = (r) => (r && value < r[0] ? 'low' : r && value > r[1] ? 'high' : null);
  const crit = outside(range.crit);
  if (crit) return { level: 'critical', side: crit };
  const warn = outside(range.warn);
  if (warn) return { level: 'warning', side: warn };
  return { level: 'ok', side: null };
}

/** Eclairage anormal : lampe defaillante le jour, lumiere restee allumee la nuit. */
export function lightAnomaly(node, lux, hour) {
  const p = SPECIES[node.species];
  if (!p || p.outdoor) return null;
  const [on, off] = p.photo;
  const fullDay = hour >= on + 0.5 && hour < off - 0.5;
  if (fullDay && lux < 0.3 * p.luxDay) return { side: 'low', label: `${lux} lx pour ${p.luxDay} lx attendus (lampe défaillante ?)` };
  const night = hour >= off + 0.5 || hour < on - 0.5;
  if (night && lux > Math.max(1500, 0.5 * p.luxDay)) return { side: 'high', label: `${lux} lx en pleine nuit (éclairage bloqué ?)` };
  return null;
}
