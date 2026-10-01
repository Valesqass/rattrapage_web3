'use strict';

// Tampon FIFO borne utilise pendant une coupure broker.
// Quand il deborde, on sacrifie d'abord les messages non critiques les plus anciens (mesures,
// heartbeats) : une mesure perdue est remplacee 30 s plus tard, une ouverture de porte non.
// Les messages critiques ne sont jamais supprimes ; la borne dure HARD_LIMIT_FACTOR * max
// protege seulement la memoire en cas de coupure tres longue.

const HARD_LIMIT_FACTOR = 4;

class OutageBuffer {
  constructor(max) {
    if (!Number.isInteger(max) || max < 1) throw new Error(`taille de tampon invalide : ${max}`);
    this.max = max;
    this.items = [];
    this.dropped = 0;
  }

  get size() {
    return this.items.length;
  }

  push(item, critical) {
    this.items.push({ ...item, critical: Boolean(critical) });
    if (this.items.length <= this.max) return;
    const victim = this.items.findIndex((it) => !it.critical);
    if (victim !== -1) {
      this.items.splice(victim, 1);
      this.dropped += 1;
      return;
    }
    if (this.items.length > this.max * HARD_LIMIT_FACTOR) {
      this.items.shift();
      this.dropped += 1;
    }
  }

  /** Vide le tampon et renvoie son contenu dans l'ordre d'arrivee. */
  drain() {
    const out = this.items;
    this.items = [];
    return out;
  }
}

module.exports = { OutageBuffer };
