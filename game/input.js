// Turns the keyboard and gamepads into one button bitmask per player per frame.
// The sim only ever sees these bits, which is also what the netcode will send.

import { BTN } from './sim/sim.js';

const { LEFT, RIGHT, UP, DOWN, JUMP, ATTACK, STRONG, SHIELD } = BTN;

// the actions a player can bind, in the order the Controls screen lists them
export const ACTIONS = [
  ['left', LEFT, 'Left'],
  ['right', RIGHT, 'Right'],
  ['up', UP, 'Up'],
  ['down', DOWN, 'Down'],
  ['jump', JUMP, 'Jump'],
  ['attack', ATTACK, 'Attack'],
  ['strong', STRONG, 'Smash'],
  ['shield', SHIELD, 'Shield'],
];

// event.code -> button, per player
export const DEFAULT_KEYS = [
  { KeyA: LEFT, KeyD: RIGHT, KeyW: UP, KeyS: DOWN, Space: JUMP, KeyF: ATTACK, KeyG: STRONG, KeyH: SHIELD },
  {
    ArrowLeft: LEFT,
    ArrowRight: RIGHT,
    ArrowUp: UP,
    ArrowDown: DOWN,
    ShiftRight: JUMP,
    Numpad0: JUMP,
    Comma: ATTACK,
    Numpad1: ATTACK,
    Period: STRONG,
    Numpad2: STRONG,
    Slash: SHIELD,
    Numpad3: SHIELD,
  },
];

// the live bindings: defaults, overridden by whatever this browser saved
const STORE = 'bv-keys-v1';
const clone = (k) => k.map((m) => ({ ...m }));
export const KEYS = clone(DEFAULT_KEYS);
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (Array.isArray(saved) && saved.length === 2 && saved.every((m) => m && typeof m === 'object')) {
    const valid = new Set(ACTIONS.map((a) => a[1]));
    saved.forEach((m, i) => {
      const clean = Object.fromEntries(Object.entries(m).filter(([k, v]) => typeof k === 'string' && valid.has(v)));
      if (Object.keys(clean).length) KEYS[i] = clean;
    });
  }
} catch {
  /* no storage (private window): defaults it is */
}

// bind `code` to `bit` for a player, replacing that action's other keys and taking the
// key away from anything else that used it
export function bindKey(player, bit, code) {
  for (const m of KEYS) delete m[code];
  for (const [k, v] of Object.entries(KEYS[player])) if (v === bit) delete KEYS[player][k];
  KEYS[player][code] = bit;
  save();
}
export function resetKeys() {
  DEFAULT_KEYS.forEach((m, i) => (KEYS[i] = { ...m }));
  save();
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(KEYS));
  } catch {
    /* storage blocked: the change lasts for this visit */
  }
}
// keys bound to an action, for display
export const keysFor = (player, bit) => Object.entries(KEYS[player]).filter(([, v]) => v === bit).map(([k]) => k);

const DEAD = 0.5; // stick dead zone
const C_DEAD = 0.6; // right stick, used as a smash stick

function padBits(p) {
  let b = 0;
  const btn = (i) => p.buttons[i]?.pressed;
  const [ax = 0, ay = 0, cx = 0, cy = 0] = p.axes;
  if (ax < -DEAD || btn(14)) b |= LEFT;
  if (ax > DEAD || btn(15)) b |= RIGHT;
  if (ay < -DEAD || btn(12)) b |= UP;
  if (ay > DEAD || btn(13)) b |= DOWN;
  if (btn(0) || btn(3)) b |= JUMP;
  if (btn(2)) b |= ATTACK;
  if (btn(1)) b |= STRONG;
  if (btn(4) || btn(5) || btn(6) || btn(7)) b |= SHIELD;
  // the right stick throws a smash attack in its direction
  if (Math.hypot(cx, cy) > C_DEAD) {
    b &= ~(LEFT | RIGHT | UP | DOWN);
    if (Math.abs(cx) > Math.abs(cy)) b |= cx < 0 ? LEFT : RIGHT;
    else b |= cy < 0 ? UP : DOWN;
    b |= STRONG;
  }
  return b;
}

export function createInput(target = window) {
  const held = new Set();
  const tapped = new Set(); // pressed since the last sample, so a tap shorter than a frame still counts
  const isGameKey = (code) => KEYS.some((m) => code in m);

  const typing = (e) => e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
  const down = (e) => {
    if (typing(e)) return;
    if (isGameKey(e.code)) {
      e.preventDefault();
      held.add(e.code);
      tapped.add(e.code);
    }
  };
  const up = (e) => held.delete(e.code);
  const clear = () => {
    held.clear();
    tapped.clear();
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  window.addEventListener('blur', clear);

  return {
    // one bitmask per player for this frame
    sample(players = 2) {
      const out = new Array(players).fill(0);
      for (let i = 0; i < players; i++) {
        const map = KEYS[i];
        if (!map) continue;
        for (const code of held) if (map[code]) out[i] |= map[code];
        for (const code of tapped) if (map[code]) out[i] |= map[code];
      }
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      pads.forEach((p, i) => {
        if (i < players) out[i] |= padBits(p);
      });
      tapped.clear();
      return out;
    },
    pads() {
      return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0;
    },
    clear,
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    },
  };
}
