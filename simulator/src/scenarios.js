'use strict';

// Scenarios d'incidents.
//  normal    : aucun incident, uniquement la vie du centre
//  incidents : sequence d'incidents fixe, deroulee pendant les premieres heures simulees
//  chaos     : incidents aleatoires en continu

function buildScenario(name, sim) {
  const events = [];
  const at = (minutesFromStart, fn) => events.push({ t: sim.startedAt + minutesFromStart * 60_000, fn, done: false });
  const enc = (id) => sim.enclosures.get(id);
  const node = (id) => sim.nodes.get(id);

  if (name === 'incidents') {
    at(25, () => { enc('DES-02').faults.add('door_stuck_open'); sim.openEnclosureDoor('DES-02', true); });
    at(75, () => { enc('DES-02').faults.delete('door_stuck_open'); sim.openEnclosureDoor('DES-02', false); });
    at(40, () => { node('N-TRO-03').probeFault = { sensor: 'temp_hot', mode: 'disconnected' }; });
    at(52, () => { node('N-TRO-03').probeFault = null; });
    at(60, () => { enc('DES-04').faults.add('lamp_failure'); });
    at(90, () => { enc('TRO-05').faults.add('thermostat_stuck'); });
    at(105, () => { sim.setOffline('N-QUA-03', 15 * 60); });
    at(120, () => { node('N-SOI-02').probeFault = { sensor: 'temp_cold', mode: 'por' }; });
    at(150, () => { node('N-SOI-02').probeFault = null; });
    at(160, () => { sim.setRoomPower('QUA', false); });
    at(182, () => { sim.setRoomPower('QUA', true); });
    at(0, () => { node('N-TRO-06').clockDriftMsPerMin = 4000; });
    at(0, () => { node('N-EXT-02').battery = 14; node('N-EXT-02').fastDrain = false; });
    at(200, () => { node('N-EXT-02').fastDrain = true; });
    at(0, () => {
      // Intrusion nocturne : premiere nuit a 02:37
      const d = new Date(sim.now);
      d.setDate(d.getDate() + (d.getHours() >= 2 ? 1 : 0));
      d.setHours(2, 37, 12, 0);
      events.push({ t: d.getTime(), fn: () => { sim.pulseBuildingDoor('N-DOOR-FEED', 95); }, done: false });
    });
  }

  let nextChaos = sim.startedAt + 10 * 60_000;
  const chaos = () => {
    const rng = sim.rng;
    const encIds = [...sim.enclosures.keys()].filter((id) => !id.startsWith('EXT'));
    const pick = rng.pick(['probe', 'offline', 'lamp', 'stuck', 'door', 'por', 'drift']);
    const id = rng.pick(encIds);
    const e = enc(id);
    const n = node(`N-${id}`);
    const later = (min, fn) => events.push({ t: sim.now + min * 60_000, fn, done: false });
    switch (pick) {
      case 'probe':
        n.probeFault = { sensor: rng.pick(['temp_hot', 'temp_cold']), mode: 'disconnected' };
        later(rng.int(3, 20), () => { n.probeFault = null; });
        break;
      case 'por':
        n.probeFault = { sensor: rng.pick(['temp_hot', 'temp_cold']), mode: 'por' };
        later(rng.int(5, 30), () => { n.probeFault = null; });
        break;
      case 'offline':
        sim.setOffline(n.id, rng.int(2, 25) * 60);
        break;
      case 'lamp':
        e.faults.add('lamp_failure');
        later(rng.int(30, 120), () => e.faults.delete('lamp_failure'));
        break;
      case 'stuck':
        e.faults.add('thermostat_stuck');
        later(rng.int(20, 60), () => e.faults.delete('thermostat_stuck'));
        break;
      case 'door':
        e.faults.add('door_stuck_open');
        sim.openEnclosureDoor(id, true);
        later(rng.int(15, 60), () => { e.faults.delete('door_stuck_open'); sim.openEnclosureDoor(id, false); });
        break;
      case 'drift':
        n.clockDriftMsPerMin = rng.pick([-3000, 2500, 6000]);
        break;
    }
  };

  return {
    name,
    tick(now) {
      for (const ev of events) {
        if (!ev.done && now >= ev.t) {
          ev.done = true;
          ev.fn();
        }
      }
      if (name === 'chaos' && now >= nextChaos) {
        chaos();
        nextChaos = now + sim.rng.int(8, 35) * 60_000;
      }
    },
  };
}

module.exports = { buildScenario };
