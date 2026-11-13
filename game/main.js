// /play entry: local two-player match on the grey-box stage.
// A fixed 60 Hz sim driven by an accumulator, rendered every animation frame.

import './style.css';
import * as sim from './sim/sim.js';
import { createState, step, hash, FPS, FIGHTERS, ACT, ACT_NAMES } from './sim/sim.js';
import { RollbackSession } from './net/rollback.js';
import { createLoopback } from './net/loopback.js';
import { joinRoom, newRoomCode, ROOM_CODE } from './net/online.js';
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

// ?net=sim runs each player as its own rollback peer over a fake network (lag, jitter,
// loss from the URL) and shows P1's side: online play, felt on one machine.
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && Number.isFinite(+params.get(k)) ? +params.get(k) : d);
const NETSIM = params.get('net') === 'sim'
  ? { latency: num('lag', 80), jitter: num('jitter', 15), loss: num('loss', 0.05), delay: num('delay', 2) }
  : null;

function createDriver() {
  if (!NETSIM) {
    const s = createState();
    return { state: s, tick: (inp) => step(s, inp), info: () => '' };
  }
  const net = createLoopback(NETSIM);
  const ends = [net.a, net.b];
  const peers = [0, 1].map((i) => {
    const p = new RollbackSession({ local: i, sim, send: (b) => ends[i].send(b), delay: NETSIM.delay });
    ends[i].onMessage((b) => p.receive(b));
    return p;
  });
  const d = {
    state: peers[0].state,
    tick(inp) {
      net.pump();
      peers.forEach((p, i) => {
        if (p.canAdvance()) p.addLocalInput(inp[i]);
        p.advance();
      });
      d.state = peers[0].state; // a rollback restores a fresh state object
    },
    info() {
      const s = peers[0].stats;
      return `net sim ${NETSIM.latency}±${NETSIM.jitter} ms, ${Math.round(NETSIM.loss * 100)}% loss, delay ${NETSIM.delay}f\nrollbacks ${s.rollbacks} (max ${s.maxRollback}f)  stalls ${s.stalls}  ${s.desync >= 0 ? 'DESYNC at ' + s.desync : 'in sync @' + s.lastSync}`;
    },
  };
  return d;
}
let driver = createDriver();
let state = driver.state;
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
  // an online match keeps running under the menu: the other player is still playing
  pauseEl.hidden = !paused;
  input.clear();
  if (paused) pauseEl.querySelector('[data-act="resume"]').focus();
  else canvas.focus?.();
}
function restart() {
  if (driver.online) leaveOnline();
  driver = createDriver();
  state = driver.state;
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
  if (e.repeat || e.target.closest?.('input, textarea')) return;
  if (e.code === 'Escape') setPaused(!paused);
  else if (e.code === 'KeyR' && (paused || state.over)) restart();
  else if (e.code === 'KeyM') flash(audio.toggleMute() ? 'Sound off' : 'Sound on', 900);
  else if (e.code === 'Backquote') {
    view.setDebug(!view.debug);
    $('#debug').hidden = !view.debug;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.over && !driver.online) setPaused(true);
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
    endEl.querySelector('[data-act="restart"]').firstChild.textContent = driver.online ? 'Play locally ' : 'Rematch ';
    endEl.hidden = false;
    endEl.querySelector('[data-act="restart"]').focus();
  }, 1500);
}

/* ---------- online: Play with a Friend ---------- */
// the room service (server/): local wrangler dev while developing, the deployed Worker
// otherwise; VITE_ROOMS_URL overrides both
const ROOMS_URL =
  import.meta.env.VITE_ROOMS_URL ||
  (import.meta.env.DEV ? 'ws://127.0.0.1:8787' : 'wss://brawlverse-rooms.brawlverse-rooms.workers.dev');
const onlineEl = $('#online');
const roomStatus = $('#room-status');
let link = null; // the open transport

function status(text, error = false) {
  roomStatus.textContent = text;
  roomStatus.classList.toggle('is-error', error);
}

function onlineDriver(transport) {
  const session = new RollbackSession({ local: transport.seat, sim, send: (b) => transport.send(b) });
  transport.onMessage((b) => session.receive(b));
  let n = 0;
  let stalled = 0;
  const d = {
    online: true,
    // true while the other side has stopped sending (tab hidden, connection trouble)
    get waiting() {
      return stalled > 30;
    },
    state: session.state,
    tick(inp) {
      n++;
      // running ahead of the other side: skip every third tick until we are level
      if (session.timeSync() >= 1 && n % 3 === 0) {
        session.flush();
        return;
      }
      if (session.canAdvance()) session.addLocalInput(inp[0] | inp[1]); // either key set drives you
      stalled = session.advance() ? 0 : stalled + 1;
      d.state = session.state;
    },
    info() {
      const s = session.stats;
      return `online ${transport.mode} as P${transport.seat + 1}\nrollbacks ${s.rollbacks} (max ${s.maxRollback}f)  stalls ${s.stalls}  ${s.desync >= 0 ? 'DESYNC at ' + s.desync : 'in sync @' + s.lastSync}`;
    },
  };
  return d;
}

function openOnline(code) {
  onlineEl.hidden = false;
  setPaused(false);
  pauseEl.hidden = true;
  if (!ROOMS_URL) {
    status('Online play is not switched on for this build yet.', true);
    return;
  }
  if (code) join(code);
  else status('');
}

function join(code, hosting = false) {
  leaveOnline();
  $('#room-host').hidden = !hosting;
  $('#room-join').hidden = hosting;
  if (hosting) {
    $('#room-code').replaceChildren(
      ...[...code].map((ch) => {
        const t = document.createElement('span');
        t.textContent = ch;
        return t;
      })
    );
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    $('#room-link').value = url.toString();
  }
  link = joinRoom({
    url: ROOMS_URL,
    code,
    onStatus(s, d) {
      if (s === 'connecting') status('Connecting to the room…');
      else if (s === 'waiting') status(hosting ? 'Waiting for your friend to open the link…' : 'Waiting for the host…');
      else if (s === 'joined') status('Friend found. Connecting…');
      else if (s === 'full') status('That room already has two players.', true);
      else if (s === 'error') status(d?.message || 'Something went wrong.', true);
      else if (s === 'ready') startOnline();
      else if (s === 'left') friendLeft();
    },
  });
}

function startOnline() {
  driver = onlineDriver(link);
  state = driver.state;
  cards.forEach((c, i) => {
    c.shown = -1;
    c.lives = -1;
    c.el.querySelector('.card__tag').textContent = i === link.seat ? `P${i + 1} · You` : `P${i + 1}`;
  });
  onlineEl.hidden = true;
  endEl.hidden = true;
  setPaused(false);
  acc = 0;
  last = performance.now();
  $('.tag').textContent = `Online · ${link.mode === 'p2p' ? 'direct' : 'relayed'}`;
  flash('Fight!');
}

function friendLeft() {
  if (!driver.online) {
    status('Your friend left the room.', true);
    return;
  }
  $('#end-title').textContent = 'Your friend left';
  $('#end-sub').textContent = 'The connection closed. Start a new room to play again.';
  endEl.hidden = false;
}

function leaveOnline() {
  link?.close();
  link = null;
  cards.forEach((c, i) => (c.el.querySelector('.card__tag').textContent = `P${i + 1}`));
  $('.tag').textContent = NETSIM ? `Lag sim · ${NETSIM.latency} ms` : 'Prototype · Proving Grounds';
}

document.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'online') openOnline();
  else if (act === 'host') join(newRoomCode(), true);
  else if (act === 'close-online') {
    if (!driver.online) leaveOnline();
    onlineEl.hidden = true;
  } else if (act === 'copy') {
    try {
      await navigator.clipboard.writeText($('#room-link').value);
      status('Link copied. Send it to your friend.');
    } catch {
      $('#room-link').select();
    }
  }
});
$('#room-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase();
  if (!ROOM_CODE.test(code)) return status('Room codes are 5 letters or numbers.', true);
  join(code);
});
{
  const code = (params.get('room') || '').toUpperCase();
  if (ROOM_CODE.test(code)) openOnline(code);
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
  const net = driver.info();
  debugEl.textContent = [`frame ${state.frame}  ${fps} fps  hash ${hash(state).toString(16).padStart(8, '0')}`, ...rows, ...(net ? [net] : [])].join('\n');
}

/* ---------- loop ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(250, now - last);
  last = now;
  if (paused && !driver.online) acc = 0;
  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_STEPS) {
    driver.tick(input.sample(state.fighters.length));
    state = driver.state;
    acc -= STEP_MS;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;
  view.render(state);
  if (driver.online) document.body.classList.toggle('is-waiting', driver.waiting);
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
      for (let i = 0; i < n; i++) driver.tick(inputs);
      state = driver.state;
      view.render(state);
      return state.fighters.map((f) => `${ACT_NAMES[f.action]} af${f.af} x${(f.x / 256) | 0} y${(f.y / 256) | 0} ${f.damage}%`);
    },
    pause(on = true) {
      setPaused(on);
    },
    restart,
    view,
    info: () => driver.info(),
    hash: () => hash(state),
  };
}

window.addEventListener('gamepadconnected', (e) => flash(`Gamepad ${e.gamepad.index + 1} connected`, 1400));
if (NETSIM) $('.tag').textContent = `Lag sim · ${NETSIM.latency} ms`;
flash('Fight!');
requestAnimationFrame(frame);
