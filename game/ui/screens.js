// The menus around a match: title, character select, stage select, controls and
// results. Each screen is plain DOM over the live 3D scene, driven by keyboard
// (both players' bindings), gamepads and the mouse.

import { FIGHTERS, STAGES, BTN } from '../sim/sim.js';
import { ACTIONS, KEYS, bindKey, resetKeys, keysFor } from '../input.js';

const $ = (s) => document.querySelector(s);

function el(tag, cls = '', text = '', attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// friendly names for KeyboardEvent.code values
export function keyLabel(code) {
  const named = {
    Space: 'Space',
    ShiftRight: 'R-Shift',
    ShiftLeft: 'L-Shift',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Enter: 'Enter',
    Tab: 'Tab',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

// stage traits for the stage cards, read from the layout itself
function traits(st) {
  const w = (st.main.right - st.main.left) / 256;
  const size = w >= 1300 ? 'Wide' : w <= 1060 ? 'Tight' : 'Mid-size';
  const n = st.platforms.length;
  const t = [size, n ? `${n} platform${n > 1 ? 's' : ''}` : 'No platforms'];
  if ((st.grip ?? 100) < 100) t.push('Slippery');
  return t;
}

const STAGE_ART = {
  'Cinder Forge': 'cinder',
  'Neon Abyss': 'neon',
  'Sunken Colosseum': 'sunken',
  'Frostspire Summit': 'frostspire',
};
const STAGE_LINE = {
  'Proving Grounds': 'A grey-box hall for practice and testing.',
  'Cinder Forge': 'A foundry hung on chains over a live volcano.',
  'Neon Abyss': 'A rain-slick helipad between towers.',
  'Sunken Colosseum': 'A drowned arena where old champions still watch.',
  'Frostspire Summit': 'An ice bridge under the aurora. Mind your footing.',
};

// 1..10 bars for the select screen, from the fighters' real numbers
function statBars(c) {
  const rel = (v, lo, hi) => Math.max(1, Math.min(10, Math.round(1 + ((v - lo) / (hi - lo)) * 9)));
  const fs = c.moves.fsmash.hits[0];
  return [
    ['Power', rel(fs.dmg * fs.kbg, 1200, 2400)],
    ['Speed', rel(c.runSpeed, 5 * 256, 8 * 256)],
    ['Weight', rel(c.weight, 78, 138)],
    ['Air', rel(c.jumps * 2 + c.airSpeed / 256, 6, 10.5)],
  ];
}

export function createScreens({ audio, onPlay, onOnline, onTitle, onPreview = () => {} }) {
  const root = {
    title: $('#title'),
    select: $('#select'),
    stage: $('#stage-select'),
    controls: $('#controls'),
    results: $('#results'),
  };
  let current = null;
  let mode = 'versus'; // versus | training | online-host
  let back = null; // where Escape goes from the current screen
  let controlsDone = null; // set when Controls was opened from the pause menu
  const setup = { chars: [0, 1], stage: 1 };

  function show(name) {
    current = name;
    for (const [k, n] of Object.entries(root)) n.hidden = k !== name;
    document.body.dataset.screen = name || 'match';
    if (name === 'title') drawTitle();
    if (name === 'select') drawSelect();
    if (name === 'stage') drawStage();
    if (name === 'controls') drawControls();
  }

  /* ---------------------------------------------------------- title */
  const titleItems = [
    ['versus', 'Versus', 'Two players, one keyboard or two gamepads.'],
    ['online', 'Play online', 'Send a friend a link and fight over the internet.'],
    ['training', 'Training', 'Practise on the grey-box stage against a dummy.'],
    ['controls', 'Controls', 'See and change the keys.'],
  ];
  let titleIdx = 0;
  function drawTitle() {
    const menu = $('#title-menu');
    menu.replaceChildren(
      ...titleItems.map(([id, label, desc], i) => {
        const b = el('button', 'menu__item', '', { type: 'button', 'data-go': id });
        b.append(el('span', 'menu__label', label), el('span', 'menu__desc', desc));
        b.classList.toggle('is-on', i === titleIdx);
        b.addEventListener('mouseenter', () => setTitle(i, true));
        b.addEventListener('click', () => chooseTitle(i));
        return b;
      })
    );
  }
  function setTitle(i, quiet = false) {
    const n = titleItems.length;
    const next = (i + n) % n;
    if (next !== titleIdx && !quiet) audio.move();
    titleIdx = next;
    [...$('#title-menu').children].forEach((b, k) => b.classList.toggle('is-on', k === titleIdx));
  }
  function chooseTitle(i = titleIdx) {
    const id = titleItems[i][0];
    audio.confirm();
    if (id === 'versus') {
      mode = 'versus';
      back = 'title';
      show('select');
    } else if (id === 'training') {
      mode = 'training';
      back = 'title';
      show('select');
    } else if (id === 'online') {
      mode = 'online-host';
      back = 'title';
      show(null);
      onOnline();
    } else if (id === 'controls') {
      back = 'title';
      show('controls');
    }
  }

  /* ---------------------------------------------------------- character select */
  const sel = [
    { idx: 0, ready: false },
    { idx: 1, ready: false },
  ];
  const players = () => (mode === 'training' ? 1 : 2);
  function drawSelect() {
    sel[0].ready = sel[1].ready = false;
    sel[0].idx = setup.chars[0];
    sel[1].idx = setup.chars[1];
    $('#select-title').textContent = mode === 'training' ? 'Choose your fighter' : 'Choose your fighters';
    const grid = $('#select-grid');
    grid.replaceChildren(
      ...FIGHTERS.map((c, i) => {
        const card = el('button', 'fcard', '', { type: 'button', 'aria-label': `${c.name}, ${c.role}` });
        card.style.setProperty('--pc', c.color);
        const img = el('img', 'fcard__img', '', { src: `/media/fighter_${c.name.toLowerCase()}_cut.webp?v=2`, alt: '', loading: 'eager' });
        const name = el('span', 'fcard__name', c.name);
        const role = el('span', 'fcard__role', c.role);
        const badges = el('span', 'fcard__badges');
        card.append(img, el('span', 'fcard__shade'), name, role, badges);
        card.addEventListener('click', () => {
          // the mouse drives whichever player is still choosing
          const p = sel.findIndex((s, k) => k < players() && !s.ready);
          if (p < 0) return;
          sel[p].idx = i;
          lock(p);
        });
        return card;
      })
    );
    $('#select-p2').hidden = players() < 2;
    renderSelect();
  }
  function renderSelect() {
    onPreview({ chars: [sel[0].idx, players() > 1 ? sel[1].idx : (sel[0].idx + 2) % FIGHTERS.length], stage: setup.stage });
    const cards = [...$('#select-grid').children];
    cards.forEach((card, i) => {
      const b = card.querySelector('.fcard__badges');
      b.replaceChildren();
      for (let p = 0; p < players(); p++) {
        if (sel[p].idx === i) b.append(el('span', `badge badge--p${p + 1}${sel[p].ready ? ' is-ready' : ''}`, `P${p + 1}`));
      }
      card.classList.toggle('is-hot', sel.slice(0, players()).some((s) => s.idx === i));
    });
    for (let p = 0; p < 2; p++) {
      const panel = $(`#select-p${p + 1}`);
      const c = FIGHTERS[sel[p].idx];
      panel.style.setProperty('--pc', c.color);
      panel.querySelector('.ppanel__name').textContent = c.name;
      panel.querySelector('.ppanel__role').textContent = c.role;
      panel.querySelector('.ppanel__state').textContent = sel[p].ready ? 'Ready' : 'Choosing…';
      panel.classList.toggle('is-ready', sel[p].ready);
      const bars = panel.querySelector('.ppanel__stats');
      bars.replaceChildren(
        ...statBars(c).map(([label, v]) => {
          const row = el('div', 'stat');
          const bar = el('span', 'stat__bar');
          bar.style.setProperty('--v', v / 10);
          row.append(el('span', 'stat__label', label), bar);
          return row;
        })
      );
    }
  }
  function moveSel(p, d) {
    if (p >= players() || sel[p].ready) return;
    sel[p].idx = (sel[p].idx + d + FIGHTERS.length) % FIGHTERS.length;
    audio.move();
    renderSelect();
  }
  function lock(p) {
    if (p >= players()) return;
    if (sel[p].ready) {
      // both ready already: confirming again moves on
      if (sel.slice(0, players()).every((s) => s.ready)) proceedFromSelect();
      return;
    }
    sel[p].ready = true;
    audio.lockIn(p ? 0.4 : -0.4);
    renderSelect();
    if (sel.slice(0, players()).every((s) => s.ready)) setTimeout(() => current === 'select' && proceedFromSelect(), 450);
  }
  function unlock(p) {
    if (p < players() && sel[p].ready) {
      sel[p].ready = false;
      audio.back();
      renderSelect();
      return true;
    }
    return false;
  }
  function proceedFromSelect() {
    setup.chars = [sel[0].idx, mode === 'training' ? (sel[0].idx + 2) % FIGHTERS.length : sel[1].idx];
    if (mode === 'training') {
      setup.stage = 0;
      show(null);
      onPlay({ ...setup }, mode);
    } else {
      back = 'select';
      show('stage');
    }
  }

  /* ---------------------------------------------------------- stage select */
  let stageIdx = 1;
  function drawStage() {
    stageIdx = setup.stage;
    const list = $('#stage-list');
    list.replaceChildren(
      ...STAGES.map((st, i) => {
        const card = el('button', 'scard', '', { type: 'button' });
        const art = STAGE_ART[st.name];
        const pic = el('span', 'scard__art');
        if (art) pic.style.backgroundImage = `url(/media/stage_${art}.webp)`;
        else pic.classList.add('scard__art--grid');
        const meta = el('span', 'scard__meta');
        meta.append(el('span', 'scard__name', st.name), el('span', 'scard__line', STAGE_LINE[st.name] || ''));
        const tags = el('span', 'scard__tags');
        for (const t of traits(st)) tags.append(el('span', 'tagpill', t));
        meta.append(tags);
        card.append(pic, meta);
        card.addEventListener('mouseenter', () => setStageIdx(i, true));
        card.addEventListener('click', () => {
          setStageIdx(i, true);
          chooseStage();
        });
        return card;
      })
    );
    setStageIdx(stageIdx, true);
  }
  function setStageIdx(i, quiet = false) {
    const n = STAGES.length;
    const next = (i + n) % n;
    if (next !== stageIdx && !quiet) audio.move();
    stageIdx = next;
    [...$('#stage-list').children].forEach((c, k) => c.classList.toggle('is-on', k === stageIdx));
    onPreview({ chars: [sel[0].idx, sel[1].idx], stage: stageIdx });
  }
  function chooseStage() {
    setup.stage = stageIdx;
    audio.confirm();
    show(null);
    onPlay({ ...setup }, mode);
  }

  /* ---------------------------------------------------------- controls */
  let waiting = null; // { player, bit, btn } while a key is being rebound
  function drawControls() {
    const body = $('#controls-body');
    body.replaceChildren(
      ...ACTIONS.map(([, bit, label]) => {
        const tr = el('tr');
        tr.append(el('th', '', label, { scope: 'row' }));
        for (let p = 0; p < 2; p++) {
          const td = el('td');
          const b = el('button', 'bind', keysFor(p, bit).map(keyLabel).join(' / ') || '—', { type: 'button' });
          b.addEventListener('click', () => {
            if (waiting) waiting.btn.classList.remove('is-waiting');
            waiting = { player: p, bit, btn: b };
            b.textContent = 'Press a key…';
            b.classList.add('is-waiting');
          });
          td.append(b);
          tr.append(td);
        }
        return tr;
      })
    );
  }

  function leaveControls() {
    audio.back();
    if (controlsDone) {
      const fn = controlsDone;
      controlsDone = null;
      show(null);
      fn();
    } else show(back || 'title');
  }

  /* ---------------------------------------------------------- results */
  function showResults({ state, stats, online }) {
    const w = state.fighters[state.winner];
    const box = root.results;
    const c = w ? FIGHTERS[w.char] : null;
    box.style.setProperty('--pc', c ? c.color : '#ffffff');
    $('#results-title').textContent = c ? `${c.name} wins` : 'Draw';
    $('#results-sub').textContent = w ? `P${w.id + 1} · ${w.stocks} stock${w.stocks === 1 ? '' : 's'} left` : '';
    const img = $('#results-img');
    if (c) img.src = `/media/fighter_${c.name.toLowerCase()}_cut.webp?v=2`;
    img.hidden = !c;
    const rows = [
      ['KOs', (d) => d.kos],
      ['Falls', (d) => d.falls],
      ['Damage dealt', (d) => `${d.dealt}%`],
      ['Damage taken', (d) => `${d.taken}%`],
      ['Hits landed', (d) => d.hits],
      ['Best combo', (d) => (d.bestCombo > 1 ? `${d.bestCombo} hits` : '—')],
      ['Hits blocked', (d) => d.blocked],
      ['Self-destructs', (d) => d.selfDestructs],
    ];
    const head = el('tr');
    head.append(el('th'));
    state.fighters.forEach((f) => {
      const th = el('th', 'res__who', `P${f.id + 1} ${FIGHTERS[f.char].name}`);
      th.style.setProperty('--pc', FIGHTERS[f.char].color);
      head.append(th);
    });
    const tbody = $('#results-body');
    tbody.replaceChildren(
      head,
      ...rows.map(([label, get]) => {
        const tr = el('tr');
        tr.append(el('th', '', label, { scope: 'row' }));
        const vals = stats.map(get);
        stats.forEach((d, i) => {
          const td = el('td', '', String(vals[i]));
          // highlight who did better on the stats where more is better
          const better = ['KOs', 'Damage dealt', 'Hits landed', 'Best combo', 'Hits blocked'].includes(label);
          const n = stats.map((x) => parseInt(String(get(x)), 10) || 0);
          if (better && n[i] > n[1 - i]) td.classList.add('is-best');
          tr.append(td);
        });
        return tr;
      })
    );
    $('#results-rematch').hidden = !!online;
    $('#results-select').hidden = !!online;
    current = 'results';
    for (const [k, n] of Object.entries(root)) n.hidden = k !== 'results';
    document.body.dataset.screen = 'results';
    resIdx = online ? 2 : 0;
    focusResults();
    audio.fanfare();
  }
  let resIdx = 0;
  const resButtons = () => [...root.results.querySelectorAll('.actions .btn')].filter((b) => !b.hidden);
  function focusResults() {
    const bs = resButtons();
    resIdx = Math.max(0, Math.min(bs.length - 1, resIdx));
    bs.forEach((b, i) => b.classList.toggle('is-on', i === resIdx));
    bs[resIdx]?.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- input */
  // which player a key belongs to, and what it means in a menu
  function menuIntent(code) {
    for (let p = 0; p < 2; p++) {
      const bit = KEYS[p][code];
      if (bit === undefined) continue;
      if (bit === BTN.LEFT) return { p, dir: [-1, 0] };
      if (bit === BTN.RIGHT) return { p, dir: [1, 0] };
      if (bit === BTN.UP) return { p, dir: [0, -1] };
      if (bit === BTN.DOWN) return { p, dir: [0, 1] };
      if (bit === BTN.ATTACK || bit === BTN.JUMP) return { p, ok: true };
      if (bit === BTN.SHIELD || bit === BTN.STRONG) return { p, back: true };
    }
    if (code === 'Enter' || code === 'NumpadEnter') return { p: 0, ok: true };
    if (code === 'Escape' || code === 'Backspace') return { p: 0, back: true };
    return null;
  }

  function act(it) {
    if (!it) return false;
    if (current === 'title') {
      if (it.dir) setTitle(titleIdx + it.dir[1] + it.dir[0]);
      else if (it.ok) chooseTitle();
      return true;
    }
    if (current === 'select') {
      if (it.dir) moveSel(it.p, it.dir[0] + it.dir[1]);
      else if (it.ok) lock(it.p);
      else if (it.back && !unlock(it.p)) {
        audio.back();
        show(back || 'title');
      }
      return true;
    }
    if (current === 'stage') {
      if (it.dir) setStageIdx(stageIdx + it.dir[0] + it.dir[1]);
      else if (it.ok) chooseStage();
      else if (it.back) {
        audio.back();
        back = 'title';
        show('select');
      }
      return true;
    }
    if (current === 'controls') {
      if (it.back) leaveControls();
      return true;
    }
    if (current === 'results') {
      if (it.dir) {
        resIdx += it.dir[0] + it.dir[1];
        audio.move();
        focusResults();
      } else if (it.ok) resButtons()[resIdx]?.click();
      return true;
    }
    return false;
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (!current || e.repeat) return;
      if (e.target.closest?.('input, textarea')) return;
      if (current === 'controls' && waiting) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') {
          bindKey(waiting.player, waiting.bit, e.code);
          audio.confirm();
        }
        waiting = null;
        drawControls();
        return;
      }
      const it = menuIntent(e.code);
      if (it) {
        e.preventDefault();
        e.stopPropagation();
        act(it);
      }
    },
    true
  );

  // gamepads: pad i is player i; d-pad or stick to move, A to confirm, B to go back
  const padPrev = [{}, {}];
  function poll() {
    if (!current || !navigator.getGamepads) return;
    const pads = [...navigator.getGamepads()].filter(Boolean).slice(0, 2);
    pads.forEach((pad, p) => {
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      const b = (i) => !!pad.buttons[i]?.pressed;
      const now = {
        l: b(14) || ax < -0.6,
        r: b(15) || ax > 0.6,
        u: b(12) || ay < -0.6,
        d: b(13) || ay > 0.6,
        ok: b(0),
        back: b(1),
      };
      const was = padPrev[p];
      const edge = (k) => now[k] && !was[k];
      if (edge('l')) act({ p, dir: [-1, 0] });
      if (edge('r')) act({ p, dir: [1, 0] });
      if (edge('u')) act({ p, dir: [0, -1] });
      if (edge('d')) act({ p, dir: [0, 1] });
      if (edge('ok')) act({ p, ok: true });
      if (edge('back')) act({ p, back: true });
      padPrev[p] = now;
    });
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-screen-act]')?.dataset.screenAct;
    if (!go) return;
    if (go === 'controls-back') leaveControls();
    else if (go === 'controls-reset') {
      resetKeys();
      audio.confirm();
      drawControls();
    } else if (go === 'select-back') {
      audio.back();
      show(back || 'title');
    } else if (go === 'stage-back') {
      audio.back();
      show('select');
    } else if (go === 'rematch') {
      audio.confirm();
      show(null);
      onPlay({ ...setup }, mode);
    } else if (go === 'reselect') {
      audio.confirm();
      back = 'title';
      show('select');
    } else if (go === 'title') {
      audio.back();
      onTitle();
      show('title');
    }
  });

  return {
    show,
    showResults,
    poll,
    setup,
    get current() {
      return current;
    },
    get mode() {
      return mode;
    },
    set mode(m) {
      mode = m;
    },
    openControls(done) {
      controlsDone = done;
      show('controls');
    },
    openSelect(m = 'versus') {
      mode = m;
      back = 'title';
      show('select');
    },
  };
}
