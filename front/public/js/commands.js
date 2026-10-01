// Commandes vers les nodes : correlation par id, delai d'attente, retour d'acquittement visible
// (docs/protocole.md §6). Aucun renvoi automatique : relancer reste une decision de l'operateur.

import { ROOT, randomHex } from './connection.js';

export const ACK_TIMEOUT_MS = 10_000;
const EXPIRY_MS = 5 * 60_000; // en heure de reference (passerelle)
const MAX_HISTORY = 100;

export const COMMAND_STATE_LABEL = {
  sending: 'Envoi…',
  pending: 'En attente du node',
  ok: 'Acquittée',
  warning: 'Acquittée avec anomalie',
  rejected: 'Refusée par le node',
  timeout: 'Sans réponse',
  late: 'Acquittée en retard',
  error: "Échec d'envoi",
};

const uuid = () => `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${randomHex(4)}-${randomHex(12)}`;

export class Commands {
  constructor({ getConnection, engine, onChange }) {
    this.getConnection = getConnection;
    this.engine = engine;
    this.onChange = onChange;
    this.items = [];
  }

  send(def, action, value) {
    const entry = { id: uuid(), nodeId: def.id, zone: def.zone, action, value, sentAt: Date.now(), sentGw: this.engine.now, state: 'sending', detail: null, ackAt: null };
    this.items = [entry, ...this.items].slice(0, MAX_HISTORY);
    this.#publish(entry);
    return entry;
  }

  /** Renvoi manuel : meme id, le node ne l'appliquera qu'une fois (idempotence). */
  resend(id) {
    const entry = this.items.find((c) => c.id === id);
    if (!entry) return;
    Object.assign(entry, { sentAt: Date.now(), state: 'sending', detail: null });
    this.#publish(entry);
  }

  #publish(entry) {
    const conn = this.getConnection();
    const payload = { v: 1, id: entry.id, action: entry.action, value: entry.value, exp: this.engine.now + EXPIRY_MS };
    if (!conn?.connected) {
      this.#update(entry, { state: 'error', detail: 'broker injoignable' });
      return;
    }
    conn.publish(`${ROOT}/${entry.zone}/${entry.nodeId}/cmd`, payload, { qos: 1 })
      .then(() => {
        if (entry.state === 'sending') this.#update(entry, { state: 'pending' });
      })
      .catch((err) => this.#update(entry, { state: 'error', detail: err.message }));
    const sentAt = entry.sentAt;
    setTimeout(() => {
      if (entry.sentAt === sentAt && (entry.state === 'pending' || entry.state === 'sending')) {
        this.#update(entry, { state: 'timeout', detail: `aucun acquittement en ${ACK_TIMEOUT_MS / 1000} s` });
      }
    }, ACK_TIMEOUT_MS);
    this.onChange();
  }

  onAck(p) {
    const entry = this.items.find((c) => c.id === p.cmdId);
    if (!entry) return; // commande d'un autre poste operateur
    const wasLate = entry.state === 'timeout';
    let state = p.ok ? 'ok' : 'rejected';
    if (p.ok && p.detail !== 'ok' && p.detail?.startsWith('applied_but')) state = 'warning';
    if (wasLate && state === 'ok') state = 'late';
    this.#update(entry, { state, detail: p.detail, ackAt: p.gwTs });
    if (p.ok && entry.action === 'interval') this.engine.setExpectedPeriod(entry.nodeId, Number(entry.value));
  }

  forNode(nodeId) {
    return this.items.filter((c) => c.nodeId === nodeId);
  }

  #update(entry, patch) {
    Object.assign(entry, patch);
    this.onChange();
  }
}
