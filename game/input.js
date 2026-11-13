// Turns the keyboard and gamepads into one button bitmask per player per frame.
// The sim only ever sees these bits, which is also what the netcode will send.

import { BTN } from './sim/sim.js';

const { LEFT, RIGHT, UP, DOWN, JUMP, ATTACK, STRONG, SHIELD } = BTN;

// event.code -> button, per player
export const KEYS = [
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
  const gameKeys = new Set(KEYS.flatMap((m) => Object.keys(m)));

  const down = (e) => {
    if (gameKeys.has(e.code)) {
      e.preventDefault();
      held.add(e.code);
    }
  };
  const up = (e) => held.delete(e.code);
  const clear = () => held.clear();
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
      }
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      pads.forEach((p, i) => {
        if (i < players) out[i] |= padBits(p);
      });
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
