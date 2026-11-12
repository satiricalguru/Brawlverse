import './style.css';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initHero } from './hero.js';
import { initStages } from './stages.js';
import { initFighters } from './fighters3d.js';

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add('js');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = matchMedia('(max-width: 900px)').matches || (navigator.deviceMemory || 8) <= 4;
const FRAME_COUNT = 128;
const HERO_V = 2;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// progress of a tall section with a sticky child: 0 when its top hits the viewport top, 1 when its bottom hits the bottom
const sectionProgress = (el) => {
  const r = el.getBoundingClientRect();
  return clamp01(-r.top / Math.max(1, r.height - innerHeight));
};
const scrollToProgress = (el, p) => {
  const top = el.getBoundingClientRect().top + scrollY;
  window.scrollTo({ top: top + p * (el.offsetHeight - innerHeight), behavior: reduced ? 'auto' : 'smooth' });
};

/* ---------- nav ---------- */
const nav = $('#nav');
let lastY = scrollY;
addEventListener(
  'scroll',
  () => {
    const y = scrollY;
    nav.classList.toggle('is-hidden', y > lastY && y > innerHeight * 0.5);
    lastY = y;
  },
  { passive: true }
);

/* ---------- hero ---------- */
const heroEl = $('#hero');
const hero = initHero({
  canvas: $('#hero-canvas'),
  frameCount: reduced ? 0 : FRAME_COUNT,
  // bump HERO_V whenever the clip is regenerated: frames are served immutable
  frameUrl: (i) => `/frames/f_${String(i).padStart(3, '0')}.webp?v=${HERO_V}`,
  poster: reduced ? `/media/hero_end.webp?v=${HERO_V}` : `/media/hero_start.webp?v=${HERO_V}`,
  lite,
});
const heroTitle = $('#hero-title');
const heroShade = $('#hero-shade');
const heroBars = $('#hero-bars');
const heroBar = $('#hero-bar');
const heroCount = $('#hero-count');
const beats = $$('.beat').map((el) => ({ el, a: +el.dataset.in, b: +el.dataset.out }));

const wordmark = $('#wordmark');
wordmark.innerHTML = [...wordmark.textContent.trim()].map((c) => `<span aria-hidden="true">${c}</span>`).join('');
// once the letters have landed, the title takes a pointer-following colour light
const lightWordmark = () => {
  gsap.set('#wordmark span', { clearProps: 'transform' });
  wordmark.classList.add('is-lit');
  if (reduced || !matchMedia('(hover: hover)').matches) return;
  const toX = gsap.quickTo(wordmark, '--hx', { duration: 0.6, ease: 'power3.out' });
  const toY = gsap.quickTo(wordmark, '--hy', { duration: 0.6, ease: 'power3.out' });
  const hero = $('#hero');
  hero.addEventListener('pointermove', (e) => {
    const b = wordmark.getBoundingClientRect();
    toX(((e.clientX - b.left) / b.width) * 100);
    toY(((e.clientY - b.top) / b.height) * 100);
    wordmark.classList.add('is-hot');
  });
  hero.addEventListener('pointerleave', () => wordmark.classList.remove('is-hot'));
};
if (reduced) lightWordmark();
if (!reduced) {
  gsap.from('#wordmark span', { yPercent: 110, duration: 1.3, stagger: 0.045, ease: 'expo.out', delay: 0.1, onComplete: lightWordmark });
  gsap.from('.hero__title .label, .hero__tag, .hero__cta', {
    opacity: 0,
    y: 20,
    duration: 1,
    stagger: 0.12,
    ease: 'power3.out',
    delay: 0.7,
  });
}

let heroP = 0;
function updateHero(dt) {
  const target = sectionProgress(heroEl);
  const prev = heroP;
  heroP += (target - heroP) * Math.min(1, dt * 9);
  if (Math.abs(target - heroP) < 0.0004) heroP = target;
  const p = heroP;

  // the footage starts moving on the first pixel of scroll
  hero?.setProgress(clamp01(p / 0.93), ((p - prev) / Math.max(dt, 0.001)) * 9000);

  // title: zoom through and out
  const t = clamp01(p / 0.13);
  heroTitle.style.opacity = 1 - t * t;
  heroTitle.style.transform = `scale(${1 + t * 1.9})`;
  heroTitle.style.visibility = t >= 1 ? 'hidden' : '';
  heroTitle.style.pointerEvents = t > 0.25 ? 'none' : '';

  heroShade.style.opacity = 1 - smooth(0.02, 0.16, p) * 0.5;
  heroBars.style.setProperty('--bars', smooth(0.08, 0.2, p) * (1 - smooth(0.86, 0.93, p)));

  for (const { el, a, b } of beats) {
    const o = smooth(a, a + 0.045, p) * (1 - smooth(b - 0.045, b, p));
    el.style.opacity = o;
    el.style.transform = `translate3d(0, ${(1 - smooth(a, a + 0.07, p)) * 46 - smooth(b - 0.07, b, p) * 30}px, 0)`;
  }
  heroBar.style.transform = `scaleX(${p})`;
  heroCount.textContent = String(Math.round(p * 100)).padStart(2, '0');
}

/* ---------- statement: words light up as you read ---------- */
const statement = $('#statement');
statement.innerHTML = statement.textContent
  .trim()
  .split(/\s+/)
  .map((w) => `<span class="w">${w}</span>`)
  .join(' ');
const words = $$('.w', statement);
function updateStatement() {
  const r = statement.getBoundingClientRect();
  const p = clamp01((innerHeight * 0.85 - r.top) / (innerHeight * 0.55 + r.height * 0.6));
  const n = Math.round(p * words.length);
  words.forEach((w, i) => w.classList.toggle('on', i < n));
}

/* ---------- fighters ---------- */
const FIGHTERS = [
  { name: 'Kael', role: 'Bruiser · Cinder Forge', color: '#ff6a2b', img: '/media/fighter_kael_cut.webp?v=2', model: '/models/mixamo/kael.glb', idle: 'Idle', intro: 'Attack', desc: 'Slow to start, impossible to stop. Full plate and heavy blows that end stocks early.', stats: [9, 4, 5] },
  { name: 'Nyx', role: 'Duelist · Neon Abyss', color: '#39d5ff', img: '/media/fighter_nyx_cut.webp?v=2', model: '/models/mixamo/nyx.glb', idle: 'Idle', desc: 'A long blade and a fast dash that punishes anything left hanging.', stats: [6, 8, 9] },
  { name: 'Bramm', role: 'Heavyweight · Sunken Colosseum', color: '#4dff9a', img: '/media/fighter_bramm_cut.webp?v=2', model: '/models/mixamo/bramm.glb', idle: 'Idle', desc: 'The hardest fighter to launch. Shrugs off light hits and answers with the whole arena.', stats: [10, 2, 6] },
  { name: 'Zephra', role: 'Acrobat · Frostspire Summit', color: '#c77dff', img: '/media/fighter_zephra_cut.webp?v=2', model: '/models/mixamo/zephra.glb', idle: 'Idle', desc: 'Lives in the air. Extra jumps, flying kicks, and the best recovery in the roster.', stats: [4, 10, 5] },
];
const fightersEl = $('#fighters');
const fightersSticky = $('#fighters-sticky');
const fighterFx = initFighters({ canvas: $('#fighters-canvas'), fighters: FIGHTERS, lite, reduced });
if (!fighterFx) document.documentElement.classList.add('no-webgl');
const fEls = {
  ghost: $('#fighter-ghost'),
  no: $('#fighter-no'),
  role: $('#fighter-role'),
  name: $('#fighter-name'),
  desc: $('#fighter-desc'),
  stats: $$('#fighter-stats div'),
  dots: $$('#fighter-dots button'),
  fallback: $('#fighter-fallback'),
};
/* outlined name behind the model: an svg so its stroke can be drawn and lit */
const SVGNS = 'http://www.w3.org/2000/svg';
function renderGhost(name) {
  const g = fEls.ghost;
  g.textContent = '';
  g.classList.add('is-svg');
  const svg = document.createElementNS(SVGNS, 'svg');
  const layer = (cls) => {
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('class', cls);
    t.setAttribute('x', '0');
    t.setAttribute('dominant-baseline', 'alphabetic');
    t.textContent = name.toUpperCase();
    svg.appendChild(t);
    return t;
  };
  const fill = layer('ghost__fill');
  const base = layer('ghost__base');
  const runs = reduced ? [] : [layer('ghost__run'), layer('ghost__run ghost__run--b')];
  g.appendChild(svg);
  // size the svg to the text so the existing centring transform keeps working
  const fit = () => {
    const b = base.getBBox();
    const pad = 8;
    svg.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
    svg.setAttribute('width', b.width + pad * 2);
    svg.setAttribute('height', b.height + pad * 2);
  };
  fit();
  document.fonts?.ready.then(fit);
  if (reduced) return;
  // draw-in: the outline traces itself, the runners and fill follow
  gsap.fromTo(base, { strokeDasharray: 1200, strokeDashoffset: 1200 }, { strokeDashoffset: 0, duration: 1.8, ease: 'power2.inOut' });
  gsap.fromTo([fill, ...runs], { opacity: 0 }, { opacity: 1, duration: 1, delay: 0.9, ease: 'power1.out', clearProps: 'opacity' });
}
addEventListener('resize', () => fighterNow >= 0 && renderGhost(FIGHTERS[fighterNow].name));

let fighterNow = -1;
function setFighter(i) {
  if (i === fighterNow) return;
  const dir = i > fighterNow ? 1 : -1;
  const first = fighterNow < 0;
  fighterNow = i;
  const f = FIGHTERS[i];
  fightersSticky.style.setProperty('--fc', f.color);
  fEls.dots.forEach((b, k) => b.classList.toggle('is-active', k === i));
  fighterFx?.go(i, dir);
  const swap = () => {
    renderGhost(f.name);
    fEls.no.textContent = `0${i + 1}`;
    fEls.role.textContent = f.role;
    fEls.name.textContent = f.name;
    fEls.desc.textContent = f.desc;
    fEls.fallback.src = f.img;
    fEls.stats.forEach((row, k) => {
      row.querySelector('dd').style.setProperty('--v', f.stats[k] / 10);
      row.querySelector('span').textContent = String(f.stats[k]).padStart(2, '0');
    });
  };
  if (reduced || first) return swap();
  const text = [fEls.role, fEls.name, fEls.desc];
  gsap.killTweensOf([...text, fEls.ghost]);
  gsap
    .timeline()
    .to(text, { y: -24 * dir, opacity: 0, duration: 0.25, ease: 'power2.in' })
    .to(fEls.ghost, { opacity: 0, xPercent: -8 * dir, duration: 0.25 }, 0)
    .add(swap)
    .fromTo(text, { y: 40 * dir, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.07, ease: 'expo.out' })
    .fromTo(fEls.ghost, { opacity: 0, xPercent: 8 * dir }, { opacity: 1, xPercent: 0, duration: 1.1, ease: 'expo.out' }, '<');
}
setFighter(0);
function updateFighters() {
  const f = Math.min(sectionProgress(fightersEl) * FIGHTERS.length, FIGHTERS.length - 0.001);
  const i = Math.floor(f);
  setFighter(i);
  fighterFx?.setScroll(0);
}
fEls.dots.forEach((b) =>
  b.addEventListener('click', () => scrollToProgress(fightersEl, (+b.dataset.i + 0.5) / FIGHTERS.length))
);

/* ---------- stages ---------- */
const STAGES = [
  { name: 'Cinder Forge', src: '/media/stage_cinder.webp', depth: '/media/stage_cinder_depth.webp', glow: '#ff6a1a', desc: 'A foundry hung on chains inside a live volcano. The lava below is not decoration.' },
  { name: 'Neon Abyss', src: '/media/stage_neon.webp', depth: '/media/stage_neon_depth.webp', glow: '#ff3df0', desc: 'A rain-slick helipad between towers. A long way down on both sides.' },
  { name: 'Sunken Colosseum', src: '/media/stage_sunken.webp', depth: '/media/stage_sunken_depth.webp', glow: '#2de2ff', desc: 'A drowned arena where the old champions still watch from the walls.' },
  { name: 'Frostspire Summit', src: '/media/stage_frostspire.webp', depth: '/media/stage_frostspire_depth.webp', glow: '#9dffd6', desc: 'An ice bridge under the aurora. Footing is a privilege here.' },
];
const stagesEl = $('#stages');
const stageFx = initStages({ canvas: $('#stages-canvas'), stages: STAGES, lite, reduced });
const stageBtns = $$('#stages-list button');
const stageName = $('#stage-name');
const stageDesc = $('#stage-desc');
const stageIdx = $('#stage-idx');
let stageNow = -1;
function setStage(i) {
  if (i === stageNow) return;
  const first = stageNow < 0;
  stageNow = i;
  const s = STAGES[i];
  stageBtns.forEach((b, k) => b.classList.toggle('is-active', k === i));
  stageFx ? stageFx.go(i) : ($('.stages__sticky').style.backgroundImage = `url(${s.src})`);
  const swap = () => {
    stageName.textContent = s.name;
    stageDesc.textContent = s.desc;
    stageIdx.textContent = `0${i + 1}`;
  };
  if (reduced || first) return swap();
  gsap.killTweensOf([stageName, stageDesc]);
  gsap
    .timeline()
    .to([stageName, stageDesc], { y: -20, opacity: 0, duration: 0.22, ease: 'power2.in' })
    .add(swap)
    .fromTo([stageName, stageDesc], { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.08, ease: 'expo.out' });
}
setStage(0);
function updateStages() {
  const f = Math.min(sectionProgress(stagesEl) * STAGES.length, STAGES.length - 0.001);
  const i = Math.floor(f);
  setStage(i);
  stageBtns.forEach((b, k) => b.style.setProperty('--p', k < i ? 1 : k === i ? f - i : 0));
}
stageBtns.forEach((b) =>
  b.addEventListener('click', () => scrollToProgress(stagesEl, (+b.dataset.i + 0.5) / STAGES.length))
);

/* ---------- one loop reads scroll and drives every pinned scene ---------- */
const onScreen = (el) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
};
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const heroOn = onScreen(heroEl);
  hero?.setVisible(heroOn);
  if (heroOn && !reduced) updateHero(dt);
  if (!reduced) updateStatement();
  const fOn = onScreen(fightersEl);
  fighterFx?.setVisible(fOn);
  if (fOn) updateFighters();
  const sOn = onScreen(stagesEl);
  stageFx?.setVisible(sOn);
  if (sOn) updateStages();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- reveals ---------- */
if (!reduced) {
  $$('.friend__left > *, .build__head > *, .intro .label, .intro__meta div, .faq__left > *, .faq details, .cta > .label, .cta > h2, .cta > p, .cta > .btn, .foot__top > *').forEach((el) => {
    gsap.from(el, { opacity: 0, y: 44, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%' } });
  });
  $$('.step').forEach((el) => {
    gsap.from(el, { opacity: 0, y: 50, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 86%' } });
  });
  gsap.from('.pipe article', {
    opacity: 0,
    y: 50,
    duration: 1.1,
    stagger: 0.1,
    ease: 'expo.out',
    scrollTrigger: { trigger: '.pipe', start: 'top 86%' },
  });
}
addEventListener('load', () => ScrollTrigger.refresh());

/* ---------- github stars ---------- */
// Live count from the public GitHub API (60 req/h per visitor IP), cached for the session.
// A private or missing repo returns 404, and the button stays a plain Star link.
const fmtStars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));
function showStars(n) {
  const el = $('#gh-stars');
  const gh = $('#gh');
  el.hidden = false;
  gh.classList.add('has-count');
  gh.setAttribute('aria-label', `Star Brawlverse on GitHub, ${n} stars`);
  if (reduced || n < 2) {
    el.textContent = fmtStars(n);
    return;
  }
  const c = { v: 0 };
  gsap.to(c, { v: n, duration: 1.4, ease: 'expo.out', onUpdate: () => (el.textContent = fmtStars(c.v)) });
}
(async () => {
  try {
    const cached = sessionStorage.getItem('bv-stars');
    if (cached !== null) return showStars(Number(cached));
  } catch {}
  try {
    const r = await fetch('https://api.github.com/repos/satiricalguru/Brawlverse', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const d = await r.json();
    if (typeof d.stargazers_count !== 'number') return;
    try {
      sessionStorage.setItem('bv-stars', String(d.stargazers_count));
    } catch {}
    showStars(d.stargazers_count);
  } catch {}
})();

/* ---------- footer wordmark: letters rise in with scroll, light follows the pointer ---------- */
{
  const mark = $('.foot__mark');
  const word = mark.textContent.trim();
  const letters = (cls) => [...word].map((ch) => `<span class="${cls}">${ch}</span>`).join('');
  mark.innerHTML = `${letters('ch')}<span class="foot__glow">${letters('')}</span>`;
  mark.classList.add('is-split');
  const chars = mark.querySelectorAll('.ch');
  if (reduced) {
    mark.classList.add('is-in');
  } else {
    gsap.set(chars, { yPercent: 115, rotateX: -70, opacity: 0 });
    gsap.to(chars, {
      yPercent: 0,
      rotateX: 0,
      opacity: 1,
      ease: 'power3.out',
      stagger: { each: 0.06, from: 'center' },
      scrollTrigger: {
        trigger: mark,
        start: 'top bottom',
        end: 'bottom bottom-=40',
        scrub: 0.8,
        onLeave: () => mark.classList.add('is-in'),
        onEnterBack: () => mark.classList.add('is-in'),
        onLeaveBack: () => mark.classList.remove('is-in', 'is-hot'),
      },
    });
    // pointer light: track inside the footer, fall back to the idle sweep when it leaves
    const foot = mark.closest('footer');
    foot.addEventListener('pointermove', (e) => {
      if (!mark.classList.contains('is-in')) return;
      const b = mark.getBoundingClientRect();
      mark.style.setProperty('--mx', `${((e.clientX - b.left) / b.width) * 100}%`);
      mark.style.setProperty('--my', `${((e.clientY - b.top) / b.height) * 100}%`);
      mark.classList.add('is-hot');
    });
    foot.addEventListener('pointerleave', () => mark.classList.remove('is-hot'));
    // a light hover lift on the letter under the pointer
    chars.forEach((ch) =>
      ch.addEventListener('pointerenter', () => {
        if (!mark.classList.contains('is-in')) return;
        gsap.fromTo(ch, { yPercent: 0 }, { yPercent: -9, duration: 0.35, ease: 'power2.out', yoyo: true, repeat: 1, overwrite: true });
      })
    );
  }
}

/* ---------- closing video: plays only while on screen ---------- */
const ctaVideo = $('#cta-video');
const ctaToggle = $('#cta-toggle');
let ctaPaused = reduced;
const syncCta = (inView) => {
  if (inView && !ctaPaused) ctaVideo.play().catch(() => {});
  else ctaVideo.pause();
  ctaToggle.textContent = ctaPaused ? 'Play video' : 'Pause video';
  ctaToggle.setAttribute('aria-pressed', String(ctaPaused));
};
let ctaInView = false;
new IntersectionObserver(
  ([e]) => {
    ctaInView = e.isIntersecting;
    syncCta(ctaInView);
  },
  { threshold: 0.15 }
).observe($('#cta'));
ctaToggle.addEventListener('click', () => {
  ctaPaused = !ctaPaused;
  syncCta(ctaInView);
});

/* footer roster links jump straight to that fighter */
$$('[data-fighter]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToProgress(fightersEl, (+a.dataset.fighter + 0.5) / FIGHTERS.length);
  })
);
