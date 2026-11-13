// /play entry: menus, local and online matches, results.
// A fixed 60 Hz sim driven by an accumulator, rendered every animation frame.
//
// Phases: 'menu' (a screen is up; the chosen stage idles behind it), 'countdown'
// (3-2-1-GO, the sim is frozen), 'match' (the sim runs), 'results' (frozen, results up).

import './style.css';
import * as sim from './sim/sim.js';
import { createState, step, hash, FPS, FIGHTERS, ACT, ACT_NAMES } from './sim/sim.js';
import { RollbackSession } from './net/rollback.js';
import { createLoopback } from './net/loopback.js';
import { joinRoom, newRoomCode, ROOM_CODE } from './net/online.js';
import { createInput } from './input.js';
import { createView } from './view/view.js';
import { createAudio } from './audio.js';
import { createScreens } from './ui/screens.js';
import { createStats } from './ui/stats.js';

const STEP_MS = 1000 / FPS;
const MAX_STEPS = 4; // after a long stall, catch up at most this many frames per draw
const TRAINING_STOCKS = 99;

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
const stats = createStats(2);
const params = new URLSearchParams(location.search);

// a link like ?p1=kael&p2=nyx&stage=cinder skips the menus and starts that match
const byName = (list, v, d) => {
  if (v == null) return d;
  const i = list.findIndex((x) => x.name.toLowerCase().startsWith(String(v).toLowerCase()));
  if (i >= 0) return i;
  return Number.isInteger(+v) && +v >= 0 && +v < list.length ? +v : d;
};
const setup = {
  chars: [byName(FIGHTERS, params.get('p1'), 0), byName(FIGHTERS, params.get('p2'), 1)],
  stage: byName(sim.STAGES, params.get('stage'), 1),
};
const direct = params.has('p1') || params.has('p2') || params.has('stage');

// ?net=sim runs each player as its own rollback peer over a fake network (lag, jitter,
// loss from the URL) and shows P1's side: online play, felt on one machine.
const num = (k, d) => (params.has(k) && Number.isFinite(+params.get(k)) ? +params.get(k) : d);
const NETSIM =
  params.get('net') === 'sim' ? { latency: num('lag', 80), jitter: num('jitter', 15), loss: num('loss', 0.05), delay: num('delay', 2) } : null;

let mode = 'versus'; // versus | training | online-host | online-guest

function createDriver() {
  const opts = { ...setup, ...(mode === 'training' ? { stocks: TRAINING_STOCKS } : {}) };
  if (!NETSIM) {
    const s = createState(opts);
    return {
      state: s,
      // the training dummy never presses anything
      tick: (inp) => step(s, mode === 'training' ? [inp[0] | inp[1], 0] : inp),
      info: () => '',
    };
  }
  const net = createLoopback(NETSIM);
  const ends = [net.a, net.b];
  const peers = [0, 1].map((i) => {
    const p = new RollbackSession({ local: i, sim, send: (b) => ends[i].send(b), delay: NETSIM.delay, stateOptions: opts });
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
const tagText = () =>
  NETSIM ? `Lag sim · ${NETSIM.latency} ms` : mode === 'training' ? 'Training' : sim.STAGES[setup.stage].name;

let phase = 'menu';
let driver = createDriver();
let state = driver.state;
let paused = false;
let acc = 0;
let last = performance.now();

/* ---------- HUD ---------- */
const cards = [...document.querySelectorAll('.card')].map((el) => ({
  el,
  pct: el.querySelector('.card__pct b'),
  stocks: el.querySelector('.card__stocks'),
  shown: -1,
  lives: -1,
  char: -1,
}));
const pctColor = (d) => {
  // white -> amber -> red as damage climbs
  const t = Math.min(1, d / 150);
  const mix = (a, b, k) => Math.round(a + (b - a) * k);
  const [r, g, b] = t < 0.5 ? [255, mix(255, 184, t * 2), mix(255, 107, t * 2)] : [255, mix(184, 59, t * 2 - 1), mix(107, 59, t * 2 - 1)];
  return `rgb(${r} ${g} ${b})`;
};
function resetHud() {
  cards.forEach((c, i) => {
    c.shown = -1;
    c.lives = -1;
    c.char = -1;
    c.el.querySelector('.card__tag').textContent = link && driver.online && i === link.seat ? `P${i + 1} · You` : `P${i + 1}`;
  });
}
function drawHud() {
  state.fighters.forEach((f, i) => {
    const card = cards[i];
    if (!card) return;
    if (card.char !== f.char) {
      card.char = f.char;
      const c = FIGHTERS[f.char];
      card.el.style.setProperty('--pc', c.color);
      card.el.querySelector('.card__name').textContent = i === 1 && mode === 'training' ? `${c.name} · Dummy` : c.name;
    }
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
      if (f.stocks > 9) card.stocks.replaceChildren(document.createTextNode('∞'));
      else
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

/* ---------- banner ---------- */
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

/* ---------- screens ---------- */
const screens = createScreens({
  audio,
  onPlay(chosen, m) {
    Object.assign(setup, chosen);
    if (m === 'online-host') {
      mode = 'online-host';
      hostRoom();
    } else {
      mode = m;
      startMatch();
    }
  },
  onOnline() {
    openOnline();
  },
  onTitle() {
    toMenu('title');
  },
  // the scene behind the menus follows what is highlighted
  onPreview(p) {
    if (phase !== 'menu') return;
    const same = state.stage === p.stage && state.fighters.every((f, i) => f.char === p.chars[i]);
    if (same) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (phase !== 'menu') return;
      screens.setup.stage = p.stage;
      const s = createState({ chars: p.chars, stage: p.stage });
      driver = { state: s, tick: () => step(s, [0, 0]), info: () => '' };
      state = s;
    }, 120);
  },
});
let previewTimer = 0;
screens.setup.chars = [...setup.chars];
screens.setup.stage = setup.stage;

// the menus' backdrop: the chosen stage with both fighters idling
function idleBackdrop() {
  phase = 'menu';
  paused = false;
  pauseEl.hidden = true;
  const s = createState({ chars: screens.setup.chars, stage: screens.setup.stage });
  driver = { state: s, tick: () => step(s, [0, 0]), info: () => '' };
  state = s;
}
function toMenu(name) {
  if (driver.online) leaveOnline();
  onlineEl.hidden = true;
  endEl.hidden = true;
  idleBackdrop();
  screens.show(name);
}

/* ---------- countdown and match ---------- */
const countEl = $('#countdown');
let countT = 0;
let countShown = -1;
function startMatch() {
  if (driver.online && mode !== 'online-host' && mode !== 'online-guest') leaveOnline();
  driver = createDriver();
  state = driver.state;
  beginCountdown();
}
function beginCountdown() {
  stats.reset();
  resetHud();
  endEl.hidden = true;
  pauseEl.hidden = true;
  paused = false;
  endShown = false;
  $('.tag').textContent = driver.online ? `Online · ${link.mode === 'p2p' ? 'direct' : 'relayed'}` : tagText();
  screens.show(null);
  phase = 'countdown';
  countT = 0;
  countShown = -1;
  acc = 0;
  last = performance.now();
}
function updateCountdown(dt) {
  countT += dt;
  // 3, 2, 1 each 0.7 s, then GO; online matches skip straight to GO so neither side waits on a timer
  const step_ = driver.online ? 3 : Math.min(3, Math.floor(countT / 700));
  if (step_ !== countShown) {
    countShown = step_;
    countEl.classList.remove('is-on', 'is-go');
    void countEl.offsetWidth;
    countEl.textContent = step_ < 3 ? String(3 - step_) : 'GO!';
    countEl.classList.add('is-on');
    if (step_ === 3) countEl.classList.add('is-go');
    audio.count(3 - step_);
  }
  if (step_ === 3) {
    phase = 'match';
    acc = 0;
  }
}

/* ---------- pause ---------- */
const pauseEl = $('#pause');
const endEl = $('#end');
function setPaused(on) {
  if (phase !== 'match') return;
  paused = on && !state.over;
  // an online match keeps running under the menu: the other player is still playing
  pauseEl.hidden = !paused;
  $('#pick-note').hidden = !driver.online;
  input.clear();
  if (paused) pauseEl.querySelector('[data-act="resume"]').focus();
}
function restart() {
  if (driver.online) return; // a rematch online needs a new room for now
  startMatch();
}
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'resume') setPaused(false);
  else if (act === 'restart') restart();
  else if (act === 'to-select') {
    const m = mode === 'training' ? 'training' : 'versus';
    toMenu(null);
    screens.openSelect(m);
  } else if (act === 'to-title') toMenu('title');
  else if (act === 'to-controls') {
    pauseEl.hidden = true;
    screens.openControls(() => {
      pauseEl.hidden = false;
      document.body.dataset.screen = 'match';
    });
  }
});
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.target.closest?.('input, textarea')) return;
  if (screens.current) return; // the menus handle their own keys
  if (e.code === 'Escape' && phase === 'match') setPaused(!paused);
  else if (e.code === 'KeyR' && paused) restart();
  else if (e.code === 'KeyM') flash(audio.toggleMute() ? 'Sound off' : 'Sound on', 900);
  else if (e.code === 'Backquote') {
    view.setDebug(!view.debug);
    $('#debug').hidden = !view.debug;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'match' && !state.over && !driver.online) setPaused(true);
});

/* ---------- game over -> results ---------- */
let endShown = false;
function checkEnd() {
  if (phase !== 'match' || !state.over || endShown) return;
  endShown = true;
  flash('Game!', 1400);
  audio.game();
  setTimeout(() => {
    if (!state.over) return;
    phase = 'results';
    screens.setup.chars = [...setup.chars];
    screens.setup.stage = setup.stage;
    screens.mode = mode === 'online-guest' ? 'versus' : mode;
    screens.showResults({ state, stats: stats.data, online: !!driver.online });
  }, 1600);
}

/* ---------- online: Play with a Friend ---------- */
// the room service (server/): local wrangler dev while developing, the deployed Worker
// otherwise; VITE_ROOMS_URL overrides both
const ROOMS_URL =
  import.meta.env.VITE_ROOMS_URL || (import.meta.env.DEV ? 'ws://127.0.0.1:8787' : 'wss://brawlverse-rooms.brawlverse-rooms.workers.dev');
const onlineEl = $('#online');
const roomStatus = $('#room-status');
let link = null; // the open transport

function status(text, error = false) {
  roomStatus.textContent = text;
  roomStatus.classList.toggle('is-error', error);
}

function onlineDriver(transport) {
  const session = new RollbackSession({ local: transport.seat, sim, send: (b) => transport.send(b), stateOptions: setup });
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
  screens.show(null);
  onlineEl.hidden = false;
  $('#room-host').hidden = true;
  $('#room-join').hidden = false;
  if (code) join(code);
  else status('Create a room to pick the match and get a link, or join with a friend’s code.');
}

// the host has picked fighters and stage on the select screens; now open the room
function hostRoom() {
  onlineEl.hidden = false;
  join(newRoomCode(), true);
}

const validSetup = (d) =>
  d &&
  Array.isArray(d.chars) &&
  d.chars.length === 2 &&
  d.chars.every((c) => Number.isInteger(c) && c >= 0 && c < FIGHTERS.length) &&
  Number.isInteger(d.stage) &&
  d.stage >= 0 &&
  d.stage < sim.STAGES.length;

function join(code, hosting = false) {
  leaveOnline();
  mode = hosting ? 'online-host' : 'online-guest';
  let gotSetup = false;
  let linkReady = false;
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
      switch (s) {
        case 'connecting':
          return status('Connecting to the room…');
        case 'waiting':
          return status(hosting ? 'Waiting for your friend to open the link…' : 'Waiting for the host…');
        case 'joined':
          if (hosting) link.sendSetup(setup);
          return status('Friend found. Connecting…');
        case 'setup':
          // the guest plays the host's match: same fighters, same stage, or the sims would diverge
          if (hosting || !validSetup(d)) return;
          Object.assign(setup, { chars: d.chars, stage: d.stage });
          gotSetup = true;
          if (linkReady) startOnline();
          return;
        case 'ready':
          linkReady = true;
          if (hosting || gotSetup) startOnline();
          else status('Connected. Getting the match from the host…');
          return;
        case 'full':
          return status('That room already has two players.', true);
        case 'error':
          return status(d?.message || 'Something went wrong.', true);
        case 'left':
          return friendLeft();
      }
    },
  });
}

function startOnline() {
  driver = onlineDriver(link);
  state = driver.state;
  onlineEl.hidden = true;
  beginCountdown();
}

function friendLeft() {
  if (!driver.online) {
    status('Your friend left the room.', true);
    return;
  }
  if (phase === 'results') return;
  $('#end-title').textContent = 'Your friend left';
  $('#end-sub').textContent = 'The connection closed. Start a new room to play again.';
  endEl.hidden = false;
}

function leaveOnline() {
  link?.close();
  link = null;
  cards.forEach((c, i) => (c.el.querySelector('.card__tag').textContent = `P${i + 1}`));
}

document.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'online') openOnline();
  else if (act === 'host') {
    // pick the match first, then the room opens with it
    onlineEl.hidden = true;
    screens.openSelect('online-host');
  } else if (act === 'close-online') {
    if (!driver.online) leaveOnline();
    onlineEl.hidden = true;
    if (!driver.online && phase !== 'match') toMenu('title');
  } else if (act === 'copy') {
    try {
      await navigator.clipboard.writeText($('#room-link').value);
      status('Link copied. Send it to your friend.');
    } catch {
      $('#room-link').select();
    }
  } else if (act === 'restart' && !endEl.hidden && driver.online) toMenu('title');
});
$('#room-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase();
  if (!ROOM_CODE.test(code)) return status('Room codes are 5 letters or numbers.', true);
  join(code);
});

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
  const g = view.gpu;
  debugEl.textContent = [
    `${phase}  frame ${state.frame}  ${fps} fps  hash ${hash(state).toString(16).padStart(8, '0')}`,
    `gpu ${g.calls} draw calls  ${(g.triangles / 1000).toFixed(0)}k tris  dpr ${g.dpr}`,
    ...rows,
    ...(net ? [net] : []),
  ].join('\n');
}

/* ---------- loop ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, now - last);
  last = now;
  screens.poll();

  if (phase === 'countdown') updateCountdown(dt);
  const running = phase === 'menu' || (phase === 'match' && !(paused && !driver.online));
  if (running) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP_MS && steps < MAX_STEPS) {
      driver.tick(input.sample(state.fighters.length));
      state = driver.state;
      acc -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
  }

  view.render(state);
  if (phase === 'match') {
    stats.update(state);
    if (driver.online) document.body.classList.toggle('is-waiting', driver.waiting);
  }
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
    get phase() {
      return phase;
    },
    // run n frames with fixed inputs, then draw once
    run(n = 1, inputs = [0, 0]) {
      for (let i = 0; i < n; i++) driver.tick(inputs);
      state = driver.state;
      view.render(state);
      if (phase === 'match') stats.update(state);
      return state.fighters.map((f) => `${ACT_NAMES[f.action]} af${f.af} x${(f.x / 256) | 0} y${(f.y / 256) | 0} ${f.damage}%`);
    },
    pause(on = true) {
      setPaused(on);
    },
    // skip the countdown in tests
    go() {
      phase = 'match';
    },
    restart,
    screens,
    stats,
    view,
    info: () => driver.info(),
    hash: () => hash(state),
  };
}

window.addEventListener('gamepadconnected', (e) => flash(`Gamepad ${e.gamepad.index + 1} connected`, 1400));

// where to start: an invite link, a direct match link, or the title screen
{
  const code = (params.get('room') || '').toUpperCase();
  if (ROOM_CODE.test(code)) {
    idleBackdrop();
    openOnline(code);
  } else if (direct || NETSIM) {
    mode = 'versus';
    startMatch();
  } else {
    toMenu('title');
  }
}
requestAnimationFrame(frame);
