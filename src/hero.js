import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Frame plane: cover-fit, slow push-in, velocity-driven RGB split, impact flash, vignette, grain.
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform vec2 uImg;
  uniform vec2 uMouse;
  uniform float uVel;
  uniform float uProg;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec2 cover(vec2 uv) {
    float rs = uRes.x / uRes.y;
    float ri = uImg.x / uImg.y;
    vec2 s = rs > ri ? vec2(1.0, ri / rs) : vec2(rs / ri, 1.0);
    // keep the action (right of centre in the footage) in frame on tall viewports
    return (uv - 0.5) * s + 0.5 + vec2(0.13 * (1.0 - s.x), 0.0);
  }

  void main() {
    vec2 uv = cover(vUv);
    uv = (uv - 0.5) * (0.965 - 0.035 * uProg) + 0.5 + uMouse * 0.01;
    vec2 dir = vUv - 0.5;
    float ab = 0.0012 + uVel * 0.02;
    vec3 col;
    col.r = texture2D(uTex, uv + dir * ab).r;
    col.g = texture2D(uTex, uv).g;
    col.b = texture2D(uTex, uv - dir * ab).b;

    // brief bloom-like lift as the fighters collide
    float impact = smoothstep(0.4, 0.48, uProg) * (1.0 - smoothstep(0.52, 0.72, uProg));
    float core = 1.0 - smoothstep(0.0, 0.55, length(dir * vec2(1.0, 1.4)));
    col += vec3(1.0, 0.62, 0.3) * core * impact * 0.16;

    float vig = smoothstep(0.95, 0.25, length(dir));
    col *= mix(0.72, 1.0, vig);
    col += (hash(vUv * uRes + uTime) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const EMBER_VERT = /* glsl */ `
  attribute vec4 aSeed; // x, y, speed, size
  uniform float uTime;
  uniform float uAmount;
  uniform float uPx;
  varying float vMix;
  varying float vAlpha;
  void main() {
    float t = uTime * (0.03 + aSeed.z * 0.07);
    float y = fract(aSeed.y + t) * 2.4 - 1.2;
    float x = aSeed.x * 2.4 - 1.2 + sin(t * 9.0 + aSeed.y * 40.0) * 0.05;
    vMix = step(0.5, aSeed.x);
    vAlpha = smoothstep(-1.2, -0.6, y) * smoothstep(1.2, 0.4, y) * (0.25 + uAmount * 0.75);
    gl_Position = vec4(x, y, 0.0, 1.0);
    gl_PointSize = (1.5 + aSeed.w * 5.0) * uPx * (0.7 + uAmount * 0.8);
  }
`;
const EMBER_FRAG = /* glsl */ `
  precision highp float;
  varying float vMix;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(0.2, 0.85, 1.0), vMix);
    gl_FragColor = vec4(c * a * vAlpha, 1.0);
  }
`;

export function initHero({ canvas, frameCount, frameUrl, poster, lite }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch {
    return null; // CSS poster stays visible
  }
  const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const texture = new THREE.Texture();
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const uniforms = {
    uTex: { value: texture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uImg: { value: new THREE.Vector2(16, 9) },
    uMouse: { value: new THREE.Vector2() },
    uVel: { value: 0 },
    uProg: { value: 0 },
    uTime: { value: 0 },
  };
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false })
    )
  );

  // embers
  const N = lite ? 90 : 220;
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const eUniforms = { uTime: uniforms.uTime, uAmount: { value: 0 }, uPx: { value: dpr } };
  const embers = new THREE.Points(
    eg,
    new THREE.ShaderMaterial({
      uniforms: eUniforms,
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
    })
  );
  embers.frustumCulled = false;
  scene.add(embers);

  // ---- frame loading: poster first, then a coarse pass, then the rest ----
  const step = lite ? 2 : 1;
  const frames = new Array(frameCount).fill(null);
  let shown = -1;
  let wanted = 0;
  let dirty = true;

  function show(img, idx) {
    // GPU storage is allocated at the first image's size; a different-sized image
    // (poster vs. frames) must reallocate or every later upload fails silently.
    const prev = texture.image;
    if (prev && (prev.naturalWidth !== img.naturalWidth || prev.naturalHeight !== img.naturalHeight)) texture.dispose();
    texture.image = img;
    texture.needsUpdate = true;
    uniforms.uImg.value.set(img.naturalWidth, img.naturalHeight);
    shown = idx;
    canvas.dataset.frame = idx;
    dirty = true;
    canvas.style.opacity = 1;
  }
  function nearest(i) {
    for (let d = 0; d < frameCount; d++) {
      if (frames[i - d]) return i - d;
      if (frames[i + d]) return i + d;
    }
    return -1;
  }
  function load(i) {
    return new Promise((res) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        frames[i] = img;
        canvas.dataset.loaded = (+canvas.dataset.loaded || 0) + 1;
        if (nearest(wanted) === i) dirty = true;
        res();
      };
      img.onerror = res;
      img.src = frameUrl(i);
    });
  }
  async function loadAll() {
    const order = [];
    for (let i = 0; i < frameCount; i += 8) order.push(i);
    for (let i = 0; i < frameCount; i += step) if (i % 8) order.push(i);
    if (!order.includes(frameCount - 1)) order.splice(1, 0, frameCount - 1);
    const pool = 6;
    let k = 0;
    await Promise.all(
      Array.from({ length: pool }, async () => {
        while (k < order.length) await load(order[k++]);
      })
    );
  }

  canvas.style.opacity = 0;
  canvas.style.transition = 'opacity .6s';
  const p = new Image();
  p.onload = () => {
    if (shown < 0) show(p, -2);
  };
  p.src = poster;
  if (frameCount > 0) loadAll();

  // ---- render loop ----
  let visible = true;
  let raf = 0;
  let last = performance.now();
  const mouse = new THREE.Vector2();
  let velTarget = 0;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
    dirty = true;
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    uniforms.uTime.value += dt;
    uniforms.uVel.value += (velTarget - uniforms.uVel.value) * 0.12;
    velTarget *= 0.9;
    uniforms.uMouse.value.lerp(mouse, 0.06);

    const n = nearest(wanted);
    if (n >= 0 && n !== shown) show(frames[n], n);
    renderer.render(scene, camera);
  }

  const onMove = (e) => mouse.set((e.clientX / innerWidth - 0.5) * -1, e.clientY / innerHeight - 0.5);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(tick);

  return {
    setProgress(pr, velocity = 0) {
      uniforms.uProg.value = pr;
      eUniforms.uAmount.value = THREE.MathUtils.smoothstep(pr, 0.25, 0.55);
      wanted = Math.round(pr * (frameCount - 1));
      velTarget = Math.min(1, Math.abs(velocity) / 2500);
    },
    setVisible(v) {
      visible = v;
      if (v) last = performance.now();
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
