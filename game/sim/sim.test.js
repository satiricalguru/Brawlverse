// Headless checks for the simulation: run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, hash, snapshot, restore, BTN, ACT, STAGES, SUB } from './sim.js';

// a seeded generator for scripted "players" (the sim itself never uses randomness)
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

// a mashing bot that holds a random set of buttons for a few frames at a time
function bot(seed) {
  const r = lcg(seed);
  let cur = 0;
  let hold = 0;
  return () => {
    if (hold-- <= 0) {
      cur = r() & 0xff;
      hold = r() % 12;
    }
    return cur;
  };
}

function run(frames, seeds = [1, 2]) {
  const s = createState();
  const bots = seeds.map(bot);
  const hashes = [];
  for (let i = 0; i < frames; i++) {
    step(s, bots.map((b) => b()));
    if (i % 60 === 0) hashes.push(hash(s));
  }
  return { s, hashes };
}

test('same inputs give the same game, frame for frame', () => {
  const a = run(7200);
  const b = run(7200);
  assert.deepEqual(a.hashes, b.hashes);
  assert.deepEqual(a.s, b.s);
});

test('different inputs give a different game', () => {
  assert.notEqual(run(600, [1, 2]).hashes.at(-1), run(600, [3, 4]).hashes.at(-1));
});

test('the state holds only integers and booleans', () => {
  const { s } = run(3000);
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const k in v) walk(v[k], `${path}.${k}`);
    else assert.ok(typeof v === 'boolean' || Number.isInteger(v), `${path} = ${v}`);
  };
  walk(s, 'state');
});

test('restoring a snapshot and replaying reaches the same state (rollback)', () => {
  const s = createState();
  const bots = [bot(9), bot(10)];
  const log = [];
  let snap = null;
  for (let i = 0; i < 2000; i++) {
    if (i === 1200) snap = snapshot(s);
    const inp = bots.map((b) => b());
    if (i >= 1200) log.push(inp);
    step(s, inp);
  }
  const replay = restore(snap);
  for (const inp of log) step(replay, inp);
  assert.equal(hash(replay), hash(s));
});

test('fighters stand on the stage and do not fall through', () => {
  const s = createState();
  for (let i = 0; i < 300; i++) step(s, [0, 0]);
  for (const f of s.fighters) {
    assert.equal(f.y, 0);
    assert.equal(f.grounded, true);
    assert.equal(f.action, ACT.IDLE);
  }
});

test('running off the edge falls past the blast zone and costs a stock', () => {
  const s = createState();
  for (let i = 0; i < 600 && s.fighters[0].stocks === 3; i++) step(s, [BTN.LEFT, 0]);
  assert.equal(s.fighters[0].stocks, 2);
});

test('falling past a ledge grabs it, and up climbs back on', () => {
  const s = createState();
  const f = s.fighters[0];
  const ledge = STAGES[0].ledges[0];
  // walk off the left edge, then hold right (toward the stage) so the fighter faces it
  let i = 0;
  for (; i < 400 && f.grounded; i++) step(s, [BTN.LEFT, 0]);
  for (; i < 600 && f.action !== ACT.LEDGE && f.stocks === 3; i++) step(s, [BTN.RIGHT, 0]);
  assert.equal(f.action, ACT.LEDGE, 'grabbed the ledge');
  for (let k = 0; k < 10; k++) step(s, [0, 0]);
  step(s, [BTN.UP, 0]);
  for (let k = 0; k < 40; k++) step(s, [0, 0]);
  assert.equal(f.grounded, true);
  assert.ok(f.x > ledge.x, 'back on stage');
});

// put the two fighters next to each other and have P1 forward-smash P2
function smashAt(damage) {
  const s = createState();
  const [a, v] = s.fighters;
  a.x = -40 * SUB;
  a.facing = 1;
  v.x = 40 * SUB;
  v.damage = damage;
  step(s, [BTN.STRONG, 0]);
  let maxX = v.x;
  for (let i = 0; i < 240 && v.action !== ACT.DEAD; i++) {
    step(s, [0, 0]);
    maxX = Math.max(maxX, v.x);
  }
  return { s, v, dist: maxX - 40 * SUB };
}

test('knockback grows with damage', () => {
  const low = smashAt(0);
  const mid = smashAt(60);
  assert.ok(low.v.damage > 0, 'the smash connected');
  assert.ok(mid.dist > low.dist * 1.5, `${mid.dist} vs ${low.dist}`);
});

test('a smash at high damage is a KO', () => {
  const { v } = smashAt(180);
  assert.equal(v.stocks, 2);
});

test('shielding blocks the damage', () => {
  const s = createState();
  const [a, v] = s.fighters;
  a.x = -40 * SUB;
  v.x = 40 * SUB;
  step(s, [0, BTN.SHIELD]);
  step(s, [BTN.ATTACK | BTN.RIGHT, BTN.SHIELD]);
  for (let i = 0; i < 40; i++) step(s, [0, BTN.SHIELD]);
  assert.equal(v.damage, 0);
  assert.ok(v.shield < 50 * SUB);
});

test('losing every stock ends the match with a winner', () => {
  const s = createState();
  for (let i = 0; i < 20000 && !s.over; i++) step(s, [BTN.LEFT, 0]);
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);
});

/* ------------------------------------------------------------ roster and stages */

import { FIGHTERS, MOVE_IDS } from './sim.js';

test('every fighter on every stage stands, and replays identically', () => {
  for (let stage = 0; stage < STAGES.length; stage++) {
    for (let a = 0; a < FIGHTERS.length; a++) {
      const b = (a + 1) % FIGHTERS.length;
      const s = createState({ chars: [a, b], stage });
      for (let i = 0; i < 240; i++) step(s, [0, 0]);
      for (const f of s.fighters) assert.ok(f.grounded && f.y === 0, `${FIGHTERS[f.char].name} on ${STAGES[stage].name}`);
      const runOnce = () => {
        const t = createState({ chars: [a, b], stage });
        const bots = [bot(stage * 10 + a), bot(stage * 10 + b + 5)];
        for (let i = 0; i < 1800; i++) step(t, bots.map((x) => x()));
        return hash(t);
      };
      assert.equal(runOnce(), runOnce());
    }
  }
});

test('frame data is whole numbers, starts no earlier than frame 2, and ends', () => {
  for (const c of FIGHTERS) {
    for (const id of MOVE_IDS) {
      const m = c.moves[id];
      for (const h of m.hits) {
        for (const k of ['f0', 'f1', 'x', 'y', 'r', 'dmg', 'ang', 'bkb', 'kbg']) assert.ok(Number.isInteger(h[k]), `${c.name} ${id}.${k}`);
        assert.ok(h.f0 >= 2 && h.f1 >= h.f0 && h.f1 < m.total, `${c.name} ${id} active ${h.f0}-${h.f1} of ${m.total}`);
      }
    }
  }
});

test('Zephra has three jumps in the air, Kael two', () => {
  const jumps = (char) => {
    const s = createState({ chars: [char, 1] });
    const f = s.fighters[0];
    let n = 0;
    let prevVy = 0;
    let airborne = false;
    for (let i = 0; i < 400; i++) {
      step(s, [i % 14 === 0 ? BTN.JUMP : 0, 0]);
      if (!f.grounded) airborne = true;
      else if (airborne) break; // landed: one airtime counted
      if (f.vy > prevVy + 5 * SUB) n++;
      prevVy = f.vy;
    }
    return n;
  };
  assert.equal(jumps(3), 3);
  assert.equal(jumps(0), 2);
});

test('the same smash launches Zephra far further than Bramm', () => {
  const launch = (victim) => {
    const s = createState({ chars: [0, victim] });
    const [a, v] = s.fighters;
    a.x = -40 * SUB;
    v.x = 60 * SUB;
    v.damage = 80;
    step(s, [BTN.STRONG, 0]);
    let far = v.x;
    for (let i = 0; i < 120; i++) {
      step(s, [0, 0]);
      far = Math.max(far, v.x);
    }
    return far - 60 * SUB;
  };
  assert.ok(launch(3) > launch(2) * 1.3, `${launch(3)} vs ${launch(2)}`);
});

test('the ice on Frostspire lets a fighter slide further', () => {
  const slide = (stage) => {
    const s = createState({ chars: [1, 0], stage });
    const f = s.fighters[0];
    for (let i = 0; i < 30; i++) step(s, [BTN.RIGHT, 0]);
    const x0 = f.x;
    for (let i = 0; i < 60; i++) step(s, [0, 0]);
    return f.x - x0;
  };
  assert.ok(slide(4) > slide(1) * 1.8, `${slide(4)} vs ${slide(1)}`);
});
