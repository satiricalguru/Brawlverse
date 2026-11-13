import { px } from './fixed.js';

// Grey-box fighters: capsules with real stats and a shared move set. The move set is
// frame data only (plain JSON-shaped objects), so M2 can swap in per-fighter data and
// animations without touching the sim.
//
// Hitbox fields: f0..f1 active frames (1-based), x/y offset from the feet (x is
// forward), r radius, dmg percent, ang launch angle in degrees (0 = forward, 90 = up,
// 270 = down), bkb base knockback, kbg knockback growth.

const hb = (f0, f1, x, y, r, dmg, ang, bkb, kbg) => ({ f0, f1, x: px(x), y: px(y), r: px(r), dmg, ang, bkb, kbg });

// total = frames until the fighter can act again; landing = landing lag for aerials;
// charge = the frame a smash attack holds on while the button is held
export const MOVES = {
  jab: { total: 17, cancel: 11, hits: [hb(3, 4, 52, 82, 30, 3, 50, 16, 24)] },
  ftilt: { total: 29, hits: [hb(7, 9, 72, 76, 34, 9, 36, 30, 82)] },
  utilt: { total: 30, hits: [hb(6, 11, 18, 158, 42, 7, 88, 32, 86)] },
  dtilt: { total: 23, hits: [hb(5, 7, 68, 18, 30, 6, 72, 30, 62)] },
  fsmash: { total: 50, charge: 10, hits: [hb(16, 18, 88, 80, 42, 16, 38, 40, 102)] },
  usmash: { total: 46, charge: 8, hits: [hb(12, 16, 0, 172, 48, 15, 90, 40, 110)] },
  dsmash: {
    total: 46,
    charge: 7,
    hits: [hb(10, 12, 72, 20, 36, 13, 28, 36, 96), hb(10, 12, -72, 20, 36, 13, 152, 36, 96)],
  },
  nair: { total: 36, landing: 8, hits: [hb(5, 20, 0, 76, 62, 8, 45, 28, 72)] },
  fair: { total: 40, landing: 12, hits: [hb(10, 13, 72, 86, 40, 12, 40, 32, 94)] },
  bair: { total: 36, landing: 10, hits: [hb(8, 11, -72, 76, 38, 13, 140, 34, 96)] },
  uair: { total: 32, landing: 8, hits: [hb(6, 10, 10, 168, 44, 9, 86, 30, 86)] },
  dair: { total: 44, landing: 18, hits: [hb(14, 17, 0, -8, 42, 14, 270, 26, 82)] },
};
export const MOVE_IDS = Object.keys(MOVES);

// Derive a fighter's move set from the shared one. Everything stays an integer.
//   dmg / kbg: percent scale     reach: extra px forward on every hitbox (a weapon)
//   size: extra px of hitbox radius   speed: frames removed (+) or added (-) to startup
//   air: same, for aerials only (applied on top of speed)
const AERIALS = new Set(['nair', 'fair', 'bair', 'uair', 'dair']);
function tune({ dmg = 100, kbg = 100, reach = 0, size = 0, speed = 0, air = 0 } = {}) {
  const out = {};
  for (const id of MOVE_IDS) {
    const m = MOVES[id];
    const shift = -(speed + (AERIALS.has(id) ? air : 0));
    const first = Math.min(...m.hits.map((h) => h.f0));
    const d = Math.max(shift, 2 - first); // never earlier than frame 2
    out[id] = {
      ...m,
      total: Math.max(m.total + d, 8),
      ...(m.charge ? { charge: Math.max(1, m.charge + d) } : {}),
      hits: m.hits.map((h) => ({
        ...h,
        f0: h.f0 + d,
        f1: h.f1 + d,
        x: h.x === 0 ? 0 : h.x + Math.sign(h.x) * px(reach),
        r: h.r + px(size),
        dmg: Math.max(1, Math.round((h.dmg * dmg) / 100)),
        kbg: Math.round((h.kbg * kbg) / 100),
      })),
    };
  }
  return out;
}

const base = {
  height: px(150),
  crouchHeight: px(96),
  radius: px(32),
  halfWidth: px(28),
  jumps: 1, // air jumps after leaving the ground
  squat: 4, // jump-squat frames
};

// the roster: ids are positions in this list, and also what the netcode sends
export const FIGHTERS = [
  {
    ...base,
    name: 'Kael',
    role: 'Bruiser',
    color: '#ff6a2b',
    // slow to start, hits like a falling anvil
    moves: tune({ dmg: 110, kbg: 104, speed: -1 }),
    weight: 112,
    runSpeed: px(6.6),
    groundAccel: px(1.1),
    friction: px(0.55),
    airSpeed: px(4.6),
    airAccel: px(0.34),
    gravity: px(0.78),
    maxFall: px(13),
    fastFall: px(19),
    fullHop: px(17.5),
    shortHop: px(11),
    airJump: px(16.5),
  },
  {
    ...base,
    name: 'Nyx',
    role: 'Duelist',
    color: '#39d5ff',
    // the greatsword: longer reach, quicker strikes, a little less weight behind them
    moves: tune({ dmg: 90, kbg: 98, reach: 34, size: 4, speed: 2 }),
    weight: 94,
    height: px(146),
    runSpeed: px(7.8),
    groundAccel: px(1.4),
    friction: px(0.7),
    airSpeed: px(5.2),
    airAccel: px(0.42),
    gravity: px(0.74),
    maxFall: px(12.5),
    fastFall: px(18.5),
    fullHop: px(17.5),
    shortHop: px(10.5),
    airJump: px(16.5),
  },
  {
    ...base,
    name: 'Bramm',
    role: 'Heavyweight',
    color: '#4dff9a',
    // the hardest to launch, and every hit is a wrecking ball; pays for it in speed
    moves: tune({ dmg: 128, kbg: 108, size: 10, reach: 10, speed: -3 }),
    weight: 136,
    height: px(178),
    crouchHeight: px(116),
    radius: px(40),
    halfWidth: px(36),
    runSpeed: px(5.4),
    groundAccel: px(0.9),
    friction: px(0.6),
    airSpeed: px(3.9),
    airAccel: px(0.28),
    gravity: px(0.86),
    maxFall: px(14),
    fastFall: px(20),
    fullHop: px(16),
    shortHop: px(10),
    airJump: px(14.5),
  },
  {
    ...base,
    name: 'Zephra',
    role: 'Acrobat',
    color: '#c77dff',
    // lives in the air: two extra jumps, fast aerials, light and easy to launch
    moves: tune({ dmg: 85, kbg: 94, speed: 1, air: 2 }),
    weight: 80,
    height: px(140),
    crouchHeight: px(88),
    radius: px(28),
    halfWidth: px(25),
    jumps: 2,
    runSpeed: px(7.4),
    groundAccel: px(1.5),
    friction: px(0.75),
    airSpeed: px(6),
    airAccel: px(0.5),
    gravity: px(0.64),
    maxFall: px(11),
    fastFall: px(16.5),
    fullHop: px(18),
    shortHop: px(11.5),
    airJump: px(15.5),
  },
];
