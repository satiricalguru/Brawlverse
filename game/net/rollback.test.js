// Two rollback peers over a simulated network (lag, jitter, loss, clock drift),
// checked against an offline replay of the inputs both sides finally agreed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../sim/sim.js';
import { RollbackSession } from './rollback.js';
import { createLoopback } from './loopback.js';
import { encode, decode, MSG } from './packets.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function bot(seed) {
  const r = lcg(seed);
  let cur = 0;
  let hold = 0;
  return () => {
    if (hold-- <= 0) {
      cur = (r() * 256) | 0;
      hold = (r() * 12) | 0;
    }
    return cur;
  };
}

function match({ frames = 3600, latency = 60, jitter = 15, loss = 0.05, drift = 0.03, seed = 1 }) {
  let clock = 0;
  const net = createLoopback({ latency, jitter, loss, random: lcg(seed), now: () => clock });
  const ends = [net.a, net.b];
  const played = [new Map(), new Map()]; // frame -> bits, what each peer really pressed
  const peers = [0, 1].map((i) => {
    const s = new RollbackSession({ local: i, sim, send: (b) => ends[i].send(b) });
    ends[i].onMessage((b) => s.receive(b));
    return s;
  });
  const bots = [bot(seed * 7 + 1), bot(seed * 7 + 2)];
  // each peer ticks on its own slightly wrong clock
  const period = [1000 / 60, (1000 / 60) * (1 + drift)];
  const next = [0, 3];
  let ticks = 0;
  while (Math.min(peers[0].frame, peers[1].frame) < frames && ticks < frames * 4) {
    const i = next[0] <= next[1] ? 0 : 1;
    clock = next[i];
    next[i] += period[i];
    net.pump();
    const s = peers[i];
    // a peer that is well ahead skips a tick so the other can catch up
    if (s.timeSync() >= 1.5 && ticks % 4 === 0) {
      s.stats.stalls++;
      s.flush();
      ticks++;
      continue;
    }
    if (s.canAdvance()) {
      const bits = bots[i]();
      const f = s.frame + s.delay;
      if (!played[i].has(f)) played[i].set(f, bits);
      s.addLocalInput(bits);
    }
    s.advance();
    ticks++;
  }
  // let the network drain so every input is confirmed on both sides
  for (let k = 0; k < 200; k++) {
    clock += 1000 / 60;
    net.set({ loss: 0 });
    net.pump();
    for (const s of peers) {
      s.flush();
      s.rollback();
    }
  }
  return { peers, played, net };
}

// replay the agreed inputs offline and return the hash at frame `at`
function reference(played, at) {
  const s = sim.createState();
  for (let f = 0; f < at; f++) sim.step(s, [played[0].get(f) ?? 0, played[1].get(f) ?? 0]);
  return sim.hash(s);
}

function stateAt(peer, f) {
  const e = peer.snaps[f % peer.size];
  assert.ok(e && e.frame === f, `peer ${peer.local} has a snapshot of frame ${f}`);
  return sim.hash(e.snap);
}

for (const net of [
  { name: 'clean LAN', latency: 5, jitter: 2, loss: 0 },
  { name: 'typical internet', latency: 60, jitter: 15, loss: 0.05 },
  { name: 'bad wifi', latency: 120, jitter: 40, loss: 0.15 },
]) {
  test(`both peers agree with the offline replay: ${net.name}`, () => {
    const { peers, played } = match({ ...net, frames: 2400, seed: 3 });
    const at = Math.min(...peers.map((p) => p.frame)) - 1;
    const want = reference(played, at);
    for (const p of peers) {
      assert.equal(stateAt(p, at), want, `peer ${p.local} at frame ${at}`);
      assert.equal(p.stats.desync, -1, 'no desync reported');
      assert.ok(p.stats.lastSync >= 1800, `desync checks ran (last at ${p.stats.lastSync})`);
    }
    if (net.latency > 30) assert.ok(peers.some((p) => p.stats.rollbacks > 0), 'predictions were corrected');
  });
}

test('rollback never reaches further back than allowed', () => {
  const { peers } = match({ latency: 120, jitter: 40, loss: 0.15, frames: 1800, seed: 9 });
  for (const p of peers) assert.ok(p.stats.maxRollback <= p.maxRollback + 1, `max ${p.stats.maxRollback}`);
});

test('a desync is detected', () => {
  const { peers } = match({ latency: 20, jitter: 0, loss: 0, frames: 200, seed: 4 });
  const [a] = peers;
  // pretend the other side reported a different hash for a frame we hashed
  a.hashes.set(9999, 1);
  a.receive(encode({ type: MSG.HASH, frame: 9999, hash: 2 }));
  assert.equal(a.stats.desync, 9999);
});

test('packets round-trip and reject garbage', () => {
  const m = { type: MSG.INPUT, player: 1, start: 123456, ack: -1, frame: 123460, adv: -3, bits: [0, 5, 255] };
  assert.deepEqual(decode(encode(m)), m);
  const h = { type: MSG.HASH, frame: 600, hash: 0xdeadbeef };
  assert.deepEqual(decode(encode(h)), h);
  assert.equal(decode(new Uint8Array([1, 2, 3])), null);
  assert.equal(decode(new Uint8Array([9])), null);
  assert.equal(decode(new Uint8Array(0)), null);
});
