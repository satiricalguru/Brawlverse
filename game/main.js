// /play entry: local two-player match on the grey-box stage.
// A fixed 60 Hz sim driven by an accumulator, rendered every animation frame.

import './style.css';
import { createState, step, hash, FPS, FIGHTERS, ACT, ACT_NAMES } from './sim/sim.js';
import { createInput } from './input.js';
import { createView } from './view/view.js';
import { createAudio } from './audio.js';

const STEP_MS = 1000 / FPS;
const MAX_STEPS = 4; // after a long stall, catch up at most this many frames per draw

const $ = (s) => document.querySelector(s);
const canvas = $('#game');

const audio = createAudio();
let view;
try {
  view = createView(canvas, { audio });
} catch (err) {
  document.body.classList.add('no-gl');
  $('#banner').textContent = 'This browser could not start WebGL.';
  throw err;
}

const input = createInput(window);
let state = createState();
let paused = false;
let acc = 0;
let last = performance.now();

/* ---------- HUD ---------- */
const cards = [...document.querySelectorAll('.card')].map((el, i) => {
  const c = FIGHTERS[state.fighters[i].char];
  el.style.setProperty('--pc', c.color);
  el.querySelector('.card__name').textContent = c.name;
  return { el, pct: el.querySelector('.card__pct b'), stocks: el.querySelector('.card__stocks'), shown: -1, lives: -1 };
});
const pctColor = (d) => {
  // white -> amber -> red as damage climbs
  const t = Math.min(1, d / 150);
  const mix = (a, b, k) => Math.round(a + (b - a) * k);
  const [r, g, b] = t < 0.5 ? [255, mix(255, 184, t * 2), mix(255, 107, t * 2)] : [255, mix(184, 59, t * 2 - 1), mix(107, 59, t * 2 - 1)];
  return `rgb(${r} ${g} ${b})`;
};
function drawHud() {
  state.fighters.forEach((f, i) => {
    const card = cards[i];
    if (!card) return;
    if (card.shown !== f.damage) {
      if (f.damage > card.shown && card.shown >= 0) {
        card.el.classList.remove('is-hit');
        void card.el.offsetWidth; // restart the shake animation
        card.el.classList.add('is-hit');
      }
      card.shown = f.damage;
      card.pct.textContent = String(f.damage);
      card.pct.parentElement.style.color = pctColor(f.damage);
    }
    if (card.lives !== f.stocks) {
      card.lives = f.stocks;
      card.stocks.replaceChildren(
        ...Array.from({ length: 3 }, (_, k) => {
          const pip = document.createElement('i');
          if (k >= f.stocks) pip.className = 'lost';
          return pip;
        })
      );
    }
    card.el.classList.toggle('is-out', f.action === ACT.DEAD && f.stocks === 0);
  });
}

/* ---------- banner, pause, end ---------- */
const banner = $('#banner');
let bannerTimer = 0;
function flash(text, ms = 1100) {
  banner.textContent = text;
  banner.classList.remove('is-on');
  void banner.offsetWidth;
  banner.classList.add('is-on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('is-on'), ms);
}

const pauseEl = $('#pause');
const endEl = $('#end');
function setPaused(on) {
  paused = on && !state.over;
  pauseEl.hidden = !paused;
  input.clear();
  if (paused) pauseEl.querySelector('[data-act="resume"]').focus();
  else canvas.focus?.();
}
function restart() {
  state = createState();
  cards.forEach((c) => {
    c.shown = -1;
    c.lives = -1;
  });
  endEl.hidden = true;
  setPaused(false);
  acc = 0;
  last = performance.now();
  flash('Fight!');
}
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'resume') setPaused(false);
  if (act === 'restart') restart();
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape') setPaused(!paused);
  else if (e.code === 'KeyR' && (paused || state.over)) restart();
  else if (e.code === 'KeyM') flash(audio.toggleMute() ? 'Sound off' : 'Sound on', 900);
  else if (e.code === 'Backquote') {
    view.setDebug(!view.debug);
    $('#debug').hidden = !view.debug;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.over) setPaused(true);
});

let endShown = false;
function checkEnd() {
  if (!state.over) {
    endShown = false;
    return;
  }
  if (endShown) return;
  endShown = true;
  const w = state.fighters[state.winner];
  const name = w ? FIGHTERS[w.char].name : 'No one';
  flash('Game!', 1400);
  setTimeout(() => {
    if (!state.over) return;
    $('#end-title').textContent = `${name} wins`;
    $('#end-sub').textContent = w ? `P${w.id + 1} took it with ${w.stocks} stock${w.stocks === 1 ? '' : 's'} left.` : 'A draw.';
    endEl.hidden = false;
    endEl.querySelector('[data-act="restart"]').focus();
  }, 1500);
}

/* ---------- debug readout ---------- */
const debugEl = $('#debug');
let fpsFrames = 0;
let fpsT = performance.now();
let fps = 0;
function drawDebug(now) {
  fpsFrames++;
  if (now - fpsT > 500) {
    fps = Math.round((fpsFrames * 1000) / (now - fpsT));
    fpsFrames = 0;
    fpsT = now;
  }
  if (!view.debug) return;
  const rows = state.fighters.map(
    (f) => `P${f.id + 1} ${ACT_NAMES[f.action].toLowerCase().padEnd(11)} f${String(f.af).padStart(3)}  hs${f.hitstun} hl${f.hitlag}`
  );
  debugEl.textContent = [`frame ${state.frame}  ${fps} fps  hash ${hash(state).toString(16).padStart(8, '0')}`, ...rows].join('\n');
}

/* ---------- loop ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(250, now - last);
  last = now;
  if (paused) acc = 0;
  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_STEPS) {
    step(state, input.sample(state.fighters.length));
    acc -= STEP_MS;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;
  view.render(state);
  drawHud();
  checkEnd();
  drawDebug(now);
}

// dev only (stripped from production builds): drive the game from the console or tests
if (import.meta.env.DEV) {
  window.__bv = {
    get state() {
      return state;
    },
    // run n frames with fixed inputs, then draw once
    run(n = 1, inputs = [0, 0]) {
      for (let i = 0; i < n; i++) step(state, inputs);
      view.render(state);
      return state.fighters.map((f) => `${ACT_NAMES[f.action]} af${f.af} x${(f.x / 256) | 0} y${(f.y / 256) | 0} ${f.damage}%`);
    },
    pause(on = true) {
      setPaused(on);
    },
    restart,
    view,
  };
}

window.addEventListener('gamepadconnected', (e) => flash(`Gamepad ${e.gamepad.index + 1} connected`, 1400));
flash('Fight!');
requestAnimationFrame(frame);
