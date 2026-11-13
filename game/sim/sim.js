// The Brawlverse simulation: a fixed 60 Hz, fully deterministic step.
//
// The state is plain data made only of integers, booleans and arrays of them, so it can
// be copied, hashed and restored cheaply. That is what rollback netcode (M3) needs: every
// client runs step() on the same inputs and reaches the same hash. Nothing here reads
// the clock, Math.random, the DOM or floats; rendering reads the state and never writes it.

import { SUB, px, idiv, clamp, toward0, approach, isin, icos, ONE } from './fixed.js';
import { FIGHTERS, MOVES, MOVE_IDS } from './fighters.js';
import { STAGE_LIST } from './stage.js';

export const STAGES = STAGE_LIST;
export { FIGHTERS, MOVES, MOVE_IDS, SUB };

export const FPS = 60;

// one bit per button in a player's input for a frame
export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, JUMP: 16, ATTACK: 32, STRONG: 64, SHIELD: 128 };
const { LEFT, RIGHT, UP, DOWN, JUMP, ATTACK, STRONG, SHIELD } = BTN;

export const ACT = {
  IDLE: 0,
  RUN: 1,
  CROUCH: 2,
  SQUAT: 3,
  AIR: 4,
  LAND: 5,
  ATTACK: 6,
  HITSTUN: 7,
  SHIELD: 8,
  SHIELDSTUN: 9,
  SHIELDBREAK: 10,
  ROLL: 11,
  SPOTDODGE: 12,
  AIRDODGE: 13,
  LEDGE: 14,
  GETUP: 15,
  DEAD: 16,
  RESPAWN: 17,
};
export const ACT_NAMES = Object.keys(ACT);

// tuning
const STOCKS = 3;
const BUFFER = 6; // frames a button press is remembered
const SHIELD_MAX = 50 * SUB;
const SHIELD_DRAIN = 30;
const SHIELD_REGEN = 18;
const KB_DECAY = px(0.51);
const KB_GROUNDED = 40; // below this knockback a grounded fighter slides instead of lifting off
const LEDGE_HOLD = 300;
const LEDGE_INVULN = 30;
const LEDGE_COOLDOWN = 30;
const GETUP_FRAMES = 30;
const RESPAWN_DELAY = 70;
const RESPAWN_HOVER = 150;
const RESPAWN_INVULN = 120;
const AIR_FRICTION = px(0.05);
const MAX_CHARGE = 60;
export { SHIELD_MAX, STOCKS };

/* ------------------------------------------------------------------ state */

function makeFighter(id, char, spawn, stocks = STOCKS) {
  return {
    id,
    char,
    x: spawn.x,
    y: spawn.y,
    vx: 0, // self-propelled speed
    vy: 0,
    kvx: 0, // knockback speed, decays separately
    kvy: 0,
    kdx: 0, // knockback decay per frame (magnitudes)
    kdy: 0,
    facing: spawn.facing,
    grounded: true,
    surf: 0, // 0 = main stage, 1.. = platform index + 1, -1 = none
    drop: 0, // frames left ignoring platforms after dropping through
    action: ACT.IDLE,
    af: 0, // frames in the current action
    move: -1, // index into MOVE_IDS while attacking
    charge: 0,
    hitMask: 0, // bit per fighter already hit by the current move
    lag: 0, // landing lag frames for ACT.LAND
    jumpsLeft: FIGHTERS[char].jumps,
    fastFall: false,
    airdodgeUsed: false,
    dodgeDir: 0, // roll direction, or 1 when an air dodge is directional
    damage: 0,
    stocks,
    hitstun: 0, // also used as the counter for shield stun and shield break
    hitlag: 0,
    shield: SHIELD_MAX,
    invuln: 0,
    ledge: -1,
    ledgeCD: 0,
    gx: 0, // ledge get-up start position
    gy: 0,
    respawnT: 0,
    held: 0, // buttons held last frame
    buf: 0, // recently pressed buttons, not yet used
    bufT: 0,
    // read by the renderer for effects
    hitFrame: -1,
    lastKb: 0,
    blocked: false,
    koFrame: -1,
    koX: 0,
    koY: 0,
  };
}

// stocks: lives per player (training uses a large number)
export function createState({ chars = [0, 1], stage = 0, stocks = STOCKS } = {}) {
  const st = STAGES[stage];
  return {
    frame: 0,
    stage,
    over: false,
    winner: -1,
    overFrame: -1,
    fighters: chars.map((c, i) => makeFighter(i, c, st.spawns[i], stocks)),
  };
}

export const snapshot = (state) => structuredClone(state);
export const restore = (snap) => structuredClone(snap);

// 32-bit FNV-1a over every field of every fighter: equal hashes, equal games
export function hash(state) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    h = Math.imul(h ^ (v | 0), 0x01000193);
  };
  mix(state.frame);
  mix(state.over ? 1 : 0);
  mix(state.winner);
  for (const f of state.fighters) {
    for (const k of FIELDS) {
      const v = f[k];
      mix(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
  }
  return h >>> 0;
}
const FIELDS = Object.keys(makeFighter(0, 0, { x: 0, y: 0, facing: 1 }));

/* ------------------------------------------------------------------ helpers */

const pressed = (f, bits) => (f.buf & bits) !== 0;
const use = (f, bits) => {
  f.buf &= ~bits;
};
const dirX = (f) => (f.held & RIGHT ? 1 : 0) - (f.held & LEFT ? 1 : 0);
const dirY = (f) => (f.held & UP ? 1 : 0) - (f.held & DOWN ? 1 : 0);

function surfaceOf(st, i) {
  return i === 0 ? st.main : st.platforms[i - 1];
}

export function heightOf(f) {
  const c = FIGHTERS[f.char];
  return f.action === ACT.CROUCH ? c.crouchHeight : c.height;
}

export function intangible(f) {
  if (f.invuln > 0) return true;
  switch (f.action) {
    case ACT.ROLL:
      return f.af >= 4 && f.af <= 16;
    case ACT.SPOTDODGE:
      return f.af >= 3 && f.af <= 15;
    case ACT.AIRDODGE:
      return f.af >= 3 && f.af <= 22;
    case ACT.GETUP:
    case ACT.DEAD:
    case ACT.RESPAWN:
      return true;
    case ACT.LEDGE:
      return f.af <= LEDGE_INVULN;
    default:
      return false;
  }
}

// active hitboxes of a fighter this frame, in world sub-pixels
export function activeHitboxes(f) {
  if (f.action !== ACT.ATTACK || f.move < 0) return [];
  const m = FIGHTERS[f.char].moves[MOVE_IDS[f.move]];
  const out = [];
  for (const h of m.hits) {
    if (f.af >= h.f0 && f.af <= h.f1) out.push({ x: f.x + h.x * f.facing, y: f.y + h.y, r: h.r, h });
  }
  return out;
}

function startMove(f, name) {
  f.action = ACT.ATTACK;
  f.move = MOVE_IDS.indexOf(name);
  f.af = 0;
  f.charge = 0;
  f.hitMask = 0;
}

function toAir(f) {
  f.action = ACT.AIR;
  f.af = 0;
  f.move = -1;
}

function releaseLedge(f) {
  f.ledge = -1;
  f.ledgeCD = LEDGE_COOLDOWN;
}

function gravity(f, c, allowFastFall = true) {
  if (allowFastFall && !f.fastFall && f.vy <= 0 && pressed(f, DOWN)) {
    use(f, DOWN);
    f.fastFall = true;
  }
  if (f.fastFall && allowFastFall) f.vy = -c.fastFall;
  else f.vy = Math.max(f.vy - c.gravity, -c.maxFall);
}

function airDrift(f, c) {
  const dx = dirX(f);
  if (dx === 0) f.vx = toward0(f.vx, AIR_FRICTION);
  else if (Math.sign(f.vx) === dx && Math.abs(f.vx) > c.airSpeed) f.vx = toward0(f.vx, AIR_FRICTION);
  else f.vx = approach(f.vx, dx * c.airSpeed, c.airAccel);
}

/* ------------------------------------------------------------------ actions */

// what a fighter standing on the ground can start; true if it started something
function groundOptions(f) {
  const dx = dirX(f);
  if (pressed(f, STRONG)) {
    use(f, STRONG | ATTACK);
    if (f.held & UP) startMove(f, 'usmash');
    else if (f.held & DOWN) startMove(f, 'dsmash');
    else {
      if (dx) f.facing = dx;
      startMove(f, 'fsmash');
    }
    return true;
  }
  if (pressed(f, ATTACK)) {
    use(f, ATTACK);
    if (f.held & UP) startMove(f, 'utilt');
    else if (f.held & DOWN) startMove(f, 'dtilt');
    else if (dx) {
      f.facing = dx;
      startMove(f, 'ftilt');
    } else startMove(f, 'jab');
    return true;
  }
  if (pressed(f, JUMP | UP)) {
    use(f, JUMP | UP);
    f.action = ACT.SQUAT;
    f.af = 0;
    return true;
  }
  if (f.held & SHIELD) {
    f.action = ACT.SHIELD;
    f.af = 0;
    return true;
  }
  if (pressed(f, DOWN) && f.surf > 0) {
    use(f, DOWN);
    f.grounded = false;
    f.surf = -1;
    f.drop = 12;
    f.y -= SUB * 2;
    toAir(f);
    return true;
  }
  return false;
}

function airOptions(f, c) {
  const dx = dirX(f);
  if (pressed(f, ATTACK | STRONG)) {
    use(f, ATTACK | STRONG);
    if (f.held & UP) startMove(f, 'uair');
    else if (f.held & DOWN) startMove(f, 'dair');
    else if (dx === f.facing) startMove(f, 'fair');
    else if (dx === -f.facing) startMove(f, 'bair');
    else startMove(f, 'nair');
    return true;
  }
  if (pressed(f, SHIELD) && !f.airdodgeUsed) {
    use(f, SHIELD);
    const dy = dirY(f);
    f.action = ACT.AIRDODGE;
    f.af = 0;
    f.airdodgeUsed = true;
    f.fastFall = false;
    if (dx || dy) {
      const s = dx && dy ? px(7.5) : px(10);
      f.vx = dx * s;
      f.vy = dy * s;
      f.dodgeDir = 1;
    } else f.dodgeDir = 0;
    return true;
  }
  if (pressed(f, JUMP | UP) && f.jumpsLeft > 0) {
    use(f, JUMP | UP);
    f.jumpsLeft--;
    f.vy = c.airJump;
    f.vx = dx * c.airSpeed;
    f.fastFall = false;
  }
  return false;
}

// ground friction for this fighter on this stage (ice has less grip)
const grip = (c, st) => idiv(c.friction * (st.grip ?? 100), 100);

function update(f, s, st) {
  const c = FIGHTERS[f.char];
  f.af++;

  switch (f.action) {
    case ACT.IDLE:
    case ACT.RUN:
    case ACT.CROUCH: {
      if (groundOptions(f)) break;
      const dx = dirX(f);
      if (f.held & DOWN) {
        f.action = ACT.CROUCH;
        f.vx = toward0(f.vx, grip(c, st));
      } else if (dx) {
        f.action = ACT.RUN;
        f.facing = dx;
        f.vx = approach(f.vx, dx * c.runSpeed, c.groundAccel);
      } else {
        f.action = ACT.IDLE;
        f.vx = toward0(f.vx, grip(c, st));
      }
      break;
    }

    case ACT.SQUAT:
      // an attack during jump-squat comes out on the ground (up + attack = up tilt, not a jump)
      if (pressed(f, ATTACK | STRONG)) {
        f.action = ACT.IDLE;
        groundOptions(f);
        break;
      }
      if (f.af >= c.squat) {
        f.vy = f.held & (JUMP | UP) ? c.fullHop : c.shortHop;
        f.grounded = false;
        f.surf = -1;
        toAir(f);
      }
      break;

    case ACT.AIR:
      if (airOptions(f, c)) {
        if (f.action === ACT.AIRDODGE) break;
      }
      airDrift(f, c);
      gravity(f, c);
      break;

    case ACT.LAND:
      f.vx = toward0(f.vx, grip(c, st));
      if (f.af >= f.lag) f.action = ACT.IDLE;
      break;

    case ACT.ATTACK: {
      const m = FIGHTERS[f.char].moves[MOVE_IDS[f.move]];
      // smash attacks hold on their charge frame while the button stays down
      if (m.charge && f.af - 1 === m.charge && f.held & STRONG && f.charge < MAX_CHARGE) {
        f.af--;
        f.charge++;
      }
      if (f.grounded) f.vx = toward0(f.vx, grip(c, st));
      else {
        airDrift(f, c);
        gravity(f, c);
      }
      if (m.cancel && f.af >= m.cancel && pressed(f, ATTACK) && !dirX(f) && !dirY(f)) {
        use(f, ATTACK);
        startMove(f, MOVE_IDS[f.move]);
        break;
      }
      if (f.af >= m.total) {
        f.move = -1;
        if (f.grounded) f.action = ACT.IDLE;
        else toAir(f);
      }
      break;
    }

    case ACT.HITSTUN:
      f.hitstun--;
      if (f.grounded) f.vx = toward0(f.vx, grip(c, st));
      else gravity(f, c, false);
      if (f.hitstun <= 0) {
        if (f.grounded) f.action = ACT.IDLE;
        else toAir(f);
      }
      break;

    case ACT.SHIELD: {
      f.vx = toward0(f.vx, grip(c, st));
      if (!(f.held & SHIELD)) {
        f.action = ACT.IDLE;
        break;
      }
      f.shield -= SHIELD_DRAIN;
      if (f.shield <= 0) {
        breakShield(f);
        break;
      }
      if (pressed(f, JUMP)) {
        use(f, JUMP);
        f.action = ACT.SQUAT;
        f.af = 0;
      } else if (pressed(f, LEFT | RIGHT) && dirX(f)) {
        use(f, LEFT | RIGHT);
        f.action = ACT.ROLL;
        f.af = 0;
        f.dodgeDir = dirX(f);
      } else if (pressed(f, DOWN)) {
        use(f, DOWN);
        f.action = ACT.SPOTDODGE;
        f.af = 0;
      }
      break;
    }

    case ACT.SHIELDSTUN:
      f.vx = toward0(f.vx, idiv(grip(c, st), 2));
      if (--f.hitstun <= 0) f.action = f.held & SHIELD ? ACT.SHIELD : ACT.IDLE;
      break;

    case ACT.SHIELDBREAK:
      if (f.grounded) f.vx = toward0(f.vx, grip(c, st));
      else gravity(f, c, false);
      if (--f.hitstun <= 0) {
        f.shield = idiv(SHIELD_MAX, 2);
        if (f.grounded) f.action = ACT.IDLE;
        else toAir(f);
      }
      break;

    case ACT.ROLL:
      f.vx = f.af >= 3 && f.af <= 20 ? f.dodgeDir * px(7) : toward0(f.vx, grip(c, st));
      if (f.af >= 28) {
        f.facing = -f.dodgeDir;
        f.action = ACT.IDLE;
      }
      break;

    case ACT.SPOTDODGE:
      f.vx = toward0(f.vx, grip(c, st));
      if (f.af >= 22) f.action = ACT.IDLE;
      break;

    case ACT.AIRDODGE:
      if (f.dodgeDir && f.af <= 14) {
        f.vx = idiv(f.vx * 9, 10);
        f.vy = idiv(f.vy * 9, 10);
      } else {
        airDrift(f, c);
        gravity(f, c, false);
      }
      if (f.af >= 34) toAir(f);
      break;

    case ACT.LEDGE: {
      const l = st.ledges[f.ledge];
      const toward = -l.side; // the direction of the stage
      f.vx = f.vy = 0;
      if (f.af >= LEDGE_HOLD) {
        releaseLedge(f);
        toAir(f);
        break;
      }
      if (f.af < 6) break;
      if (pressed(f, JUMP)) {
        use(f, JUMP | UP);
        releaseLedge(f);
        f.x = l.x + l.side * px(10);
        f.vy = c.fullHop;
        f.vx = toward * px(2);
        toAir(f);
      } else if (pressed(f, UP | ATTACK | STRONG) || (pressed(f, LEFT | RIGHT) && dirX(f) === toward)) {
        use(f, UP | ATTACK | STRONG | LEFT | RIGHT);
        f.action = ACT.GETUP;
        f.af = 0;
        f.gx = f.x;
        f.gy = f.y;
      } else if (pressed(f, DOWN) || (pressed(f, LEFT | RIGHT) && dirX(f) === -toward)) {
        use(f, DOWN | LEFT | RIGHT);
        releaseLedge(f);
        f.x += l.side * px(8);
        toAir(f);
      }
      break;
    }

    case ACT.GETUP: {
      const l = st.ledges[f.ledge];
      const tx = l.x - l.side * px(60);
      f.x = f.gx + idiv((tx - f.gx) * f.af, GETUP_FRAMES);
      f.y = f.gy + idiv((l.y - f.gy) * f.af, GETUP_FRAMES);
      if (f.af >= GETUP_FRAMES) {
        f.x = tx;
        f.y = l.y;
        f.grounded = true;
        f.surf = 0;
        f.ledge = -1;
        f.ledgeCD = LEDGE_COOLDOWN;
        f.action = ACT.IDLE;
      }
      break;
    }

    case ACT.DEAD:
      if (f.stocks > 0 && --f.respawnT <= 0) {
        const p = st.respawn[f.id % st.respawn.length];
        Object.assign(f, {
          x: p.x,
          y: p.y,
          vx: 0,
          vy: 0,
          kvx: 0,
          kvy: 0,
          damage: 0,
          shield: SHIELD_MAX,
          invuln: RESPAWN_INVULN,
          jumpsLeft: c.jumps,
          airdodgeUsed: false,
          fastFall: false,
          grounded: false,
          surf: -1,
          action: ACT.RESPAWN,
          af: 0,
        });
      }
      break;

    case ACT.RESPAWN:
      if (f.buf || dirX(f) || dirY(f) || f.af >= RESPAWN_HOVER) toAir(f);
      break;
  }
}

function breakShield(f) {
  f.shield = 0;
  f.action = ACT.SHIELDBREAK;
  f.af = 0;
  f.hitstun = 180;
  f.grounded = false;
  f.surf = -1;
  f.vy = px(12);
}

/* ------------------------------------------------------------------ movement */

const WALK_OFF = new Set([ACT.IDLE, ACT.RUN, ACT.CROUCH, ACT.HITSTUN, ACT.SHIELDBREAK]);

function land(f, c, surf, top) {
  // hard spikes bounce off the floor instead of landing
  if (f.action === ACT.HITSTUN && f.kvy < -px(4)) {
    f.kvy = idiv(-f.kvy * 7, 10);
    return false;
  }
  f.grounded = true;
  f.surf = surf;
  f.y = top;
  f.vy = 0;
  f.kvy = 0;
  f.jumpsLeft = c.jumps;
  f.airdodgeUsed = false;
  f.fastFall = false;
  if (f.action === ACT.AIR) {
    f.action = ACT.LAND;
    f.af = 0;
    f.lag = 4;
  } else if (f.action === ACT.ATTACK) {
    const m = FIGHTERS[f.char].moves[MOVE_IDS[f.move]];
    f.action = ACT.LAND;
    f.af = 0;
    f.lag = m.landing || 4;
    f.move = -1;
  } else if (f.action === ACT.AIRDODGE) {
    f.action = ACT.LAND;
    f.af = 0;
    f.lag = 10;
  }
  return true;
}

function move(f, st) {
  if (f.action === ACT.LEDGE || f.action === ACT.GETUP || f.action === ACT.DEAD || f.action === ACT.RESPAWN) return;
  const c = FIGHTERS[f.char];
  f.kvx = toward0(f.kvx, f.kdx);
  f.kvy = toward0(f.kvy, f.kdy);
  if (f.grounded) f.kvx = toward0(f.kvx, grip(c, st));

  const ox = f.x;
  const oy = f.y;
  let nx = ox + f.vx + f.kvx;
  let ny = oy + f.vy + f.kvy;

  if (f.grounded) {
    const s = surfaceOf(st, f.surf);
    if (f.kvy > 0 || f.vy > 0) {
      f.grounded = false;
      f.surf = -1;
    } else {
      ny = s.top;
      if (nx < s.left || nx > s.right) {
        if (WALK_OFF.has(f.action)) {
          f.grounded = false;
          f.surf = -1;
          if (f.action !== ACT.HITSTUN && f.action !== ACT.SHIELDBREAK) toAir(f);
        } else {
          nx = clamp(nx, s.left, s.right);
          f.vx = 0;
        }
      }
    }
  }

  if (!f.grounded) {
    const m = st.main;
    const h = c.height;
    const hw = c.halfWidth;
    const falling = ny < oy;
    let landed = false;
    if (falling && oy >= m.top && ny < m.top && nx >= m.left && nx <= m.right) {
      landed = land(f, c, 0, m.top);
      ny = m.top;
    } else if (ny < m.top && ny + h > m.bottom && nx + hw > m.left && nx - hw < m.right) {
      // the body overlaps the solid block: push it back out the way it came in
      const bounce = f.action === ACT.HITSTUN;
      if (oy + h <= m.bottom && ox + hw > m.left && ox - hw < m.right) {
        // came up from underneath: bonk the head
        ny = m.bottom - h;
        f.vy = Math.min(f.vy, 0);
        f.kvy = Math.min(f.kvy, 0);
      } else {
        // came in from a side (or slid down past a corner): out to the nearer side
        const side = ox < idiv(m.left + m.right, 2) ? -1 : 1;
        nx = side < 0 ? m.left - hw : m.right + hw;
        f.kvx = bounce ? idiv(-f.kvx, 2) : 0;
        f.vx = side < 0 ? Math.min(f.vx, 0) : Math.max(f.vx, 0);
      }
    }
    if (!landed && !f.grounded && falling && f.drop === 0) {
      for (let i = 0; i < st.platforms.length; i++) {
        const p = st.platforms[i];
        if (oy >= p.top && ny < p.top && nx >= p.left && nx <= p.right) {
          if (land(f, c, i + 1, p.top)) ny = p.top;
          break;
        }
      }
    }
  }

  f.x = nx;
  f.y = ny;
  if (f.drop > 0) f.drop--;
}

function tryLedge(f, s, st) {
  if (f.action !== ACT.AIR || f.grounded || f.ledgeCD > 0 || f.held & DOWN) return;
  if (f.vy + f.kvy > 0) return;
  for (let i = 0; i < st.ledges.length; i++) {
    const l = st.ledges[i];
    if (s.fighters.some((o) => o !== f && o.ledge === i)) continue;
    const out = (f.x - l.x) * l.side; // how far outside the stage edge
    const below = l.y - f.y;
    if (out >= -px(20) && out <= px(70) && below >= px(40) && below <= px(175)) {
      const c = FIGHTERS[f.char];
      Object.assign(f, {
        action: ACT.LEDGE,
        af: 0,
        ledge: i,
        facing: -l.side,
        x: l.x + l.side * px(30),
        y: l.y - px(140),
        vx: 0,
        vy: 0,
        kvx: 0,
        kvy: 0,
        jumpsLeft: c.jumps,
        airdodgeUsed: false,
        fastFall: false,
      });
      return;
    }
  }
}

/* ------------------------------------------------------------------ hits */

function hitsCapsule(f, cx, cy, r) {
  const c = FIGHTERS[f.char];
  const R = c.radius;
  const y0 = f.y + R;
  const y1 = f.y + heightOf(f) - R;
  const dy = cy - clamp(cy, y0, y1);
  const dx = cx - f.x;
  const rr = r + R;
  return dx * dx + dy * dy <= rr * rr;
}

function applyHit(s, a, v, h) {
  let dmg = h.dmg;
  if (a.charge) dmg += idiv(dmg * a.charge * 2, MAX_CHARGE * 5);
  const lag = 4 + idiv(dmg, 3);
  a.hitlag = lag;
  v.hitlag = lag;
  v.hitFrame = s.frame;

  if (v.action === ACT.SHIELD || v.action === ACT.SHIELDSTUN) {
    v.shield -= dmg * SUB;
    v.blocked = true;
    v.lastKb = 0;
    v.vx = a.facing * idiv(dmg * SUB, 4);
    if (v.shield <= 0) breakShield(v);
    else {
      v.action = ACT.SHIELDSTUN;
      v.hitstun = 2 + idiv(dmg, 2);
    }
    return;
  }

  const c = FIGHTERS[v.char];
  v.damage = Math.min(999, v.damage + dmg);
  const kb = h.bkb + idiv(h.kbg * v.damage, c.weight);
  const speed = idiv(kb * SUB, 5);
  const ang = a.facing < 0 ? 180 - h.ang : h.ang;
  v.kvx = idiv(speed * icos(ang), ONE);
  v.kvy = idiv(speed * isin(ang), ONE);
  v.kdx = Math.abs(idiv(KB_DECAY * icos(ang), ONE));
  v.kdy = Math.abs(idiv(KB_DECAY * isin(ang), ONE));
  if (v.grounded && kb < KB_GROUNDED && v.kvy > 0) v.kvy = 0;
  if (v.grounded && v.kvy > 0) {
    v.grounded = false;
    v.surf = -1;
  }
  if (v.ledge >= 0) releaseLedge(v);
  Object.assign(v, {
    vx: 0,
    vy: 0,
    fastFall: false,
    hitstun: idiv(kb * 2, 5),
    action: ACT.HITSTUN,
    af: 0,
    move: -1,
    charge: 0,
    lastKb: kb,
    blocked: false,
  });
}

function resolveHits(s) {
  const found = [];
  for (const a of s.fighters) {
    if (a.action !== ACT.ATTACK || a.hitlag > 0) continue;
    const boxes = activeHitboxes(a);
    if (!boxes.length) continue;
    for (const v of s.fighters) {
      if (v === a || a.hitMask & (1 << v.id) || intangible(v)) continue;
      const b = boxes.find((b) => hitsCapsule(v, b.x, b.y, b.r));
      if (b) found.push([a, v, b.h]);
    }
  }
  // all hits this frame are found first, then applied, so trades work and order is fixed
  for (const [a, v, h] of found) {
    a.hitMask |= 1 << v.id;
    applyHit(s, a, v, h);
  }
}

/* ------------------------------------------------------------------ step */

function readInput(f, cur) {
  const fresh = cur & ~f.held;
  f.held = cur;
  if (fresh) {
    f.buf |= fresh;
    f.bufT = BUFFER;
  } else if (f.bufT > 0 && f.hitlag === 0 && --f.bufT === 0) f.buf = 0;
}

function checkBlast(s, f, st) {
  if (f.action === ACT.DEAD) return;
  const b = st.blast;
  const out = f.x < b.left || f.x > b.right || f.y < b.bottom || (f.y > b.top && f.action === ACT.HITSTUN);
  if (!out) return;
  f.stocks--;
  if (f.ledge >= 0) f.ledge = -1;
  Object.assign(f, {
    action: ACT.DEAD,
    af: 0,
    move: -1,
    respawnT: RESPAWN_DELAY,
    koFrame: s.frame,
    koX: clamp(f.x, b.left, b.right),
    koY: clamp(f.y, b.bottom, b.top),
    hitstun: 0,
    hitlag: 0,
  });
}

function pushApart(s) {
  const [a, b] = s.fighters;
  if (!a || !b || !a.grounded || !b.grounded || a.surf !== b.surf) return;
  const d = b.x - a.x;
  if (Math.abs(d) >= px(44)) return;
  const dir = d > 0 ? 1 : d < 0 ? -1 : a.id < b.id ? 1 : -1;
  a.x -= dir * px(1.5);
  b.x += dir * px(1.5);
}

// advance the game one frame; inputs[i] is player i's button bits this frame
export function step(s, inputs) {
  s.frame++;
  if (s.over) return s;
  const st = STAGES[s.stage];

  for (const f of s.fighters) readInput(f, inputs[f.id] | 0);

  for (const f of s.fighters) {
    if (f.hitlag > 0) {
      f.hitlag--;
      continue;
    }
    if (f.invuln > 0) f.invuln--;
    if (f.ledgeCD > 0) f.ledgeCD--;
    if (f.action !== ACT.SHIELD && f.action !== ACT.SHIELDSTUN && f.action !== ACT.SHIELDBREAK)
      f.shield = Math.min(SHIELD_MAX, f.shield + SHIELD_REGEN);
    update(f, s, st);
    move(f, st);
    tryLedge(f, s, st);
  }

  resolveHits(s);
  for (const f of s.fighters) checkBlast(s, f, st);
  pushApart(s);

  const alive = s.fighters.filter((f) => f.stocks > 0);
  if (alive.length <= 1) {
    s.over = true;
    s.winner = alive.length ? alive[0].id : -1;
    s.overFrame = s.frame;
  }
  return s;
}
