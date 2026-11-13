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
