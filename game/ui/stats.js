// Match statistics for the results screen, read from how the sim state changes frame to
// frame. Presentation only: nothing here feeds back into the simulation.

import { ACT } from '../sim/sim.js';

export function createStats(players = 2) {
  const s = Array.from({ length: players }, () => ({
    kos: 0, // opponents sent past the blast zone
    falls: 0, // stocks lost
    selfDestructs: 0, // stocks lost without being hit since respawning
    dealt: 0, // damage done to others
    taken: 0,
    hits: 0, // hits landed (not counting blocked ones)
    blocked: 0, // hits blocked with a shield
    bestCombo: 0, // most hits landed before the victim got out of hitstun
    maxDamage: 0, // the highest % this player survived at
  }));
  const prev = []; // last seen fighter fields
  const combo = new Array(players).fill(0);
  const hitSinceRespawn = new Array(players).fill(false);
  let lastFrame = -1;

  return {
    data: s,
    // call once per rendered frame with the current state
    update(state) {
      if (state.frame === lastFrame) return;
      lastFrame = state.frame;
      state.fighters.forEach((f, i) => {
        const p = prev[i];
        const other = 1 - i; // two players: the attacker is always the other one
        if (p) {
          if (f.hitFrame !== p.hitFrame && f.hitFrame >= 0) {
            if (f.blocked) {
              s[i].blocked++;
            } else {
              const d = Math.max(0, f.damage - p.damage);
              s[other].dealt += d;
              s[i].taken += d;
              s[other].hits++;
              hitSinceRespawn[i] = true;
              // a hit while the victim was still reeling extends the combo
              combo[other] = p.action === ACT.HITSTUN ? combo[other] + 1 : 1;
              s[other].bestCombo = Math.max(s[other].bestCombo, combo[other]);
            }
          }
          if (f.action !== ACT.HITSTUN && p.action === ACT.HITSTUN) combo[other] = 0;
          if (f.stocks < p.stocks) {
            s[i].falls++;
            s[i].maxDamage = Math.max(s[i].maxDamage, p.damage);
            if (hitSinceRespawn[i]) s[other].kos++;
            else s[i].selfDestructs++;
            hitSinceRespawn[i] = false;
          }
        }
        prev[i] = { hitFrame: f.hitFrame, damage: f.damage, stocks: f.stocks, action: f.action };
      });
    },
    reset() {
      for (const x of s) Object.keys(x).forEach((k) => (x[k] = 0));
      prev.length = 0;
      combo.fill(0);
      hitSinceRespawn.fill(false);
      lastFrame = -1;
    },
  };
}
