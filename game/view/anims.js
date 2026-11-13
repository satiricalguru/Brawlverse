// Which animation clip a fighter shows, and at what time, for a given sim state.
//
// Animation follows the sim's frame counters, never the wall clock: a frame of game
// always shows the same pose, which keeps rollback re-simulation from popping the
// animation and lines each attack's impact up with its first active hitbox frame.

import { ACT, FIGHTERS, MOVE_IDS, FPS } from '../sim/sim.js';

// a clip that is missing falls back along this chain, ending at Idle
export const FALLBACK = {
  run: ['Idle'],
  crouch: ['Idle'],
  squat: ['crouch', 'land'],
  jump: ['fall'],
  airjump: ['jump', 'fall'],
  fall: ['Idle'],
  land: ['crouch'],
  hurt: ['Idle'],
  tumble: ['hurt'],
  shield: ['crouch', 'Idle'],
  shieldbreak: ['hurt'],
  roll: ['spotdodge', 'shield'],
  spotdodge: ['shield'],
  airdodge: ['spotdodge', 'fall'],
  ledge: ['fall'],
  getup: ['land', 'Idle'],
  respawn: ['fall'],
  jab: ['ftilt'],
  ftilt: ['jab', 'fsmash'],
  utilt: ['usmash', 'jab'],
  dtilt: ['dsmash', 'jab'],
  fsmash: ['ftilt', 'jab'],
  usmash: ['utilt', 'jab'],
  dsmash: ['dtilt', 'jab'],
  nair: ['fair', 'jump'],
  fair: ['nair', 'ftilt'],
  bair: ['fair', 'nair'],
  uair: ['utilt', 'nair'],
  dair: ['dtilt', 'nair'],
};

// clips whose own vertical motion must go: the sim owns the height while airborne
export const AIR_CLIPS = new Set(['jump', 'airjump', 'fall', 'tumble', 'airdodge', 'respawn', 'nair', 'fair', 'bair', 'uair', 'dair']);

// per fighter, per attack clip: [start, impact, end] in seconds. The wind-up (start..impact)
// plays over the move's startup frames and the recovery (impact..end) over the rest, so
// the blow lands exactly on the first active hitbox frame. Measured from the clips with
// tools: the moment the striking hand or foot is furthest from the hips.
export const CLIP_WINDOWS = {
  Kael: {
    jab: [0.36, 0.6, 1.0],
    ftilt: [0.13, 1.07, 1.7],
    utilt: [0.1, 0.58, 1.23],
    dtilt: [0.7, 0.9, 1.3],
    fsmash: [0.61, 1.2, 1.6],
    usmash: [0.23, 0.48, 0.88],
    dsmash: [0.48, 1.3, 1.7],
    nair: [0.31, 0.93, 1.33],
    fair: [0, 0.67, 1.07],
    bair: [0.03, 0.8, 1.2],
    uair: [0, 1.5, 1.9],
    dair: [0.13, 1.53, 1.9],
  },
};

export function resolveClip(name, has) {
  const seen = new Set();
  const queue = [name];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n)) continue;
    seen.add(n);
    if (has(n)) return n;
    queue.push(...(FALLBACK[n] || []));
  }
  return 'Idle';
}

// the wanted clip, how to play it (loop or once) and the sim-time to sample
export function pick(f) {
  const t = f.af / FPS;
  switch (f.action) {
    case ACT.IDLE:
      return { name: 'Idle', loop: true, t: f.af / FPS };
    case ACT.RUN:
      return { name: 'run', loop: true, t, rate: 1.1 };
    case ACT.CROUCH:
      return { name: 'crouch', loop: true, t };
    case ACT.SQUAT:
      return { name: 'squat', u: Math.min(1, f.af / 4) * 0.3 };
    case ACT.AIR:
      if (f.vy > 0 && f.af < 40) return { name: f.jumpsLeft < 1 ? 'airjump' : 'jump', t };
      return { name: 'fall', loop: true, t };
    case ACT.LAND:
      return { name: 'land', u: Math.min(1, f.af / Math.max(1, f.lag)), span: 0.3 };
    case ACT.ATTACK: {
      const id = MOVE_IDS[f.move];
      const m = FIGHTERS[f.char].moves[id];
      return { name: id, attack: m, af: f.af };
    }
    case ACT.HITSTUN:
      return { name: f.lastKb > 80 ? 'tumble' : 'hurt', u: Math.min(1, f.af / 20) };
    case ACT.SHIELD:
    case ACT.SHIELDSTUN:
      return { name: 'shield', loop: true, t };
    case ACT.SHIELDBREAK:
      return { name: 'shieldbreak', loop: true, t };
    case ACT.ROLL:
      return { name: 'roll', u: f.af / 28 };
    case ACT.SPOTDODGE:
      return { name: 'spotdodge', u: f.af / 22 };
    case ACT.AIRDODGE:
      return { name: 'airdodge', u: f.af / 34 };
    case ACT.LEDGE:
      return { name: 'ledge', loop: true, t };
    case ACT.GETUP:
      return { name: 'getup', u: f.af / 30 };
    case ACT.RESPAWN:
      return { name: 'respawn', loop: true, t };
    default:
      return { name: 'Idle', loop: true, t };
  }
}

// time into a clip of `duration` seconds for a pick; win is the clip's [start, impact, end]
export function sampleTime(p, duration, win) {
  if (p.attack) {
    const [s, imp, e] = win || [0, duration * 0.4, duration];
    const f0 = p.attack.hits[0].f0;
    if (p.af <= f0) return s + (p.af / f0) * (imp - s);
    return Math.min(e, imp + ((p.af - f0) / Math.max(1, p.attack.total - f0)) * (e - imp));
  }
  if (p.u !== undefined) return Math.min(0.999, Math.max(0, p.u)) * duration * (p.span || 1);
  const t = p.t * (p.rate || 1);
  return p.loop ? t % duration : Math.min(t, duration * 0.999);
}
