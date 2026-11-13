// Rollback netcode for two (or more) peers that each run the same deterministic sim.
//
// Every frame each peer simulates immediately with its own input (delayed a couple of
// frames to hide some latency) and a prediction for the others (their last known input).
// When a real remote input arrives that differs from the prediction used, the session
// restores the snapshot taken before that frame and re-simulates up to the present.
// Inputs are sent redundantly (every unacknowledged frame in every packet), so a lost
// packet costs nothing as long as a later one arrives. Peers trade a state hash for
// fully confirmed frames every second to detect a desync, and slow down by a frame when
// they run ahead of the other side so neither has to roll back further than needed.
//
// Frame f's inputs move the state from f to f + 1; snapshot[f] is the state before them.

import { encode, decode, MSG } from './packets.js';

export class RollbackSession {
  /**
   * @param {object} o
   * @param {number} o.local      this peer's player index
   * @param {number} o.players
   * @param {object} o.sim        { createState, step, snapshot, restore, hash }
   * @param {(bytes: Uint8Array) => void} o.send
   * @param {number} [o.delay]       local input delay in frames
   * @param {number} [o.maxRollback] how far ahead of the last confirmed remote frame we may run
   * @param {number} [o.syncEvery]   frames between desync checks
   */
  constructor({ local, players = 2, sim, send, delay = 2, maxRollback = 8, syncEvery = 60, stateOptions }) {
    Object.assign(this, { local, players, sim, send, delay, maxRollback, syncEvery });
    this.state = sim.createState(stateOptions);
    this.frame = 0; // next frame to simulate
    this.size = 128; // ring buffer length, well beyond maxRollback + delay
    this.snaps = new Array(this.size); // [frame % size] -> { frame, snap }
    this.inputs = Array.from({ length: players }, () => new Map()); // frame -> bits (confirmed)
    this.used = new Map(); // frame -> bits used for each player when simulated
    this.confirmed = new Array(players).fill(-1); // last frame with a confirmed input, per player
    this.lastBits = new Array(players).fill(0); // most recent confirmed input, the prediction
    this.acked = -1; // last local frame the remote has acknowledged
    this.remoteFrame = 0; // remote's current frame, as last reported
    this.remoteAdv = 0; // how far ahead the remote thinks it is
    this.rollbackFrom = Infinity;
    this.hashes = new Map(); // frame -> our hash, waiting for theirs
    this.remoteHashes = new Map();
    this.stats = { rollbacks: 0, rolledFrames: 0, maxRollback: 0, stalls: 0, desync: -1, lastSync: -1 };
    // the first `delay` frames have no local input
    for (let f = 0; f < delay; f++) this.inputs[local].set(f, 0);
    this.confirmed[local] = delay - 1;
  }

  /* -------------------------------------------------------------- inputs */

  // record this frame's local input; it applies `delay` frames from now
  addLocalInput(bits) {
    const f = this.frame + this.delay;
    if (!this.inputs[this.local].has(f)) {
      this.inputs[this.local].set(f, bits);
      this.confirmed[this.local] = f;
    }
    this.flush();
  }

  // send every local input the remote has not acknowledged yet, plus our progress
  flush() {
    const from = Math.max(this.acked + 1, this.confirmed[this.local] - 31);
    const to = this.confirmed[this.local];
    const bits = [];
    for (let f = from; f <= to; f++) bits.push(this.inputs[this.local].get(f) ?? 0);
    const remote = this.remotePlayer();
    this.send(
      encode({
        type: MSG.INPUT,
        player: this.local,
        start: from,
        bits,
        ack: this.confirmed[remote],
        frame: this.frame,
        adv: this.frame - this.remoteFrame,
      })
    );
  }

  remotePlayer() {
    return this.local === 0 ? 1 : 0;
  }

  receive(bytes) {
    const m = decode(bytes);
    if (!m) return;
    if (m.type === MSG.INPUT) {
      this.remoteFrame = Math.max(this.remoteFrame, m.frame);
      this.remoteAdv = m.adv;
      if (m.ack > this.acked) this.acked = m.ack;
      for (let k = 0; k < m.bits.length; k++) this.addRemoteInput(m.player, m.start + k, m.bits[k]);
    } else if (m.type === MSG.HASH) {
      this.remoteHashes.set(m.frame, m.hash);
      this.compareHashes();
    }
  }

  addRemoteInput(p, f, bits) {
    if (f <= this.confirmed[p]) return; // already have it (redundant copy)
    if (f !== this.confirmed[p] + 1) return; // a gap: wait for the packet that fills it
    this.inputs[p].set(f, bits);
    this.confirmed[p] = f;
    this.lastBits[p] = bits;
    // we already simulated this frame on a guess; if the guess was wrong, go back
    const used = this.used.get(f);
    if (f < this.frame && used && used[p] !== bits) this.rollbackFrom = Math.min(this.rollbackFrom, f);
  }

  // the input player p has for frame f: confirmed, or predicted from their last one
  inputFor(p, f) {
    const v = this.inputs[p].get(f);
    if (v !== undefined) return v;
    return this.lastBits[p];
  }

  /* -------------------------------------------------------------- simulation */

  minConfirmed() {
    return Math.min(...this.confirmed);
  }

  // may we simulate the next frame without outrunning the prediction window?
  canAdvance() {
    return this.frame - this.minConfirmed() <= this.maxRollback;
  }

  // frames we are ahead of the remote, halved: positive means we should wait a little
  timeSync() {
    const local = this.frame - this.remoteFrame;
    return (local - this.remoteAdv) / 2;
  }

  // re-simulate from the first mispredicted frame up to the present
  rollback() {
    if (this.rollbackFrom === Infinity) return;
    const from = this.rollbackFrom;
    this.rollbackFrom = Infinity;
    const entry = this.snaps[from % this.size];
    if (!entry || entry.frame !== from) throw new Error(`no snapshot for frame ${from}`);
    this.state = this.sim.restore(entry.snap);
    const to = this.frame;
    this.frame = from;
    while (this.frame < to) this.simulate();
    this.stats.rollbacks++;
    this.stats.rolledFrames += to - from;
    this.stats.maxRollback = Math.max(this.stats.maxRollback, to - from);
  }

  simulate() {
    const f = this.frame;
    this.snaps[f % this.size] = { frame: f, snap: this.sim.snapshot(this.state) };
    const bits = [];
    for (let p = 0; p < this.players; p++) bits.push(this.inputFor(p, f));
    this.used.set(f, bits);
    this.sim.step(this.state, bits);
    this.frame++;
  }

  /**
   * One tick of the game loop: roll back if needed, then simulate one frame if allowed.
   * Returns false when the session had to wait (for inputs or to let the remote catch up).
   */
  advance() {
    this.rollback();
    if (!this.canAdvance()) {
      this.stats.stalls++;
      this.flush();
      return false;
    }
    this.simulate();
    this.checkSync();
    this.prune();
    return true;
  }

  /* -------------------------------------------------------------- desync check */

  checkSync() {
    // a frame is fully known once every player's input up to it is confirmed;
    // snapshot[k] is then final, so both peers can hash it
    const known = this.minConfirmed() + 1;
    let k = (Math.floor(this.stats.lastSync / this.syncEvery) + 1) * this.syncEvery;
    if (this.stats.lastSync < 0) k = this.syncEvery;
    for (; k <= known && k < this.frame; k += this.syncEvery) {
      const e = this.snaps[k % this.size];
      if (!e || e.frame !== k) continue;
      const h = this.sim.hash(e.snap);
      this.hashes.set(k, h);
      this.stats.lastSync = k;
      this.send(encode({ type: MSG.HASH, frame: k, hash: h }));
    }
    this.compareHashes();
  }

  compareHashes() {
    for (const [f, h] of this.hashes) {
      if (!this.remoteHashes.has(f)) continue;
      if (this.remoteHashes.get(f) !== h && this.stats.desync < 0) this.stats.desync = f;
      this.hashes.delete(f);
      this.remoteHashes.delete(f);
    }
  }

  prune() {
    const keep = this.minConfirmed() - 2;
    for (const f of this.used.keys()) if (f < keep) this.used.delete(f);
    for (const m of this.inputs) for (const f of m.keys()) if (f < keep - 40) m.delete(f);
  }
}
