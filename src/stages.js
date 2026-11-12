import * as THREE from 'three';
import gsap from 'gsap';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Two-texture noise wipe with a hot edge, plus slow drift and pointer parallax.
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform sampler2D uDA;
  uniform sampler2D uDB;
  uniform vec2 uRes;
  uniform vec2 uImg;
  uniform vec2 uMouse;
  uniform vec3 uGlow;
  uniform float uMix;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  vec2 cover(vec2 uv) {
    float rs = uRes.x / uRes.y;
    float ri = uImg.x / uImg.y;
    vec2 s = rs > ri ? vec2(1.0, ri / rs) : vec2(rs / ri, 1.0);
    return (uv - 0.5) * s + 0.5;
  }

  void main() {
    vec2 uv = cover(vUv);
    uv = (uv - 0.5) * 0.9 + 0.5;
    // depth parallax: near pixels slide further than far ones, so the still reads as a 3D set
    vec2 par = uMouse * 2.0 + vec2(sin(uTime * 0.33), cos(uTime * 0.27) * 0.5) * 0.55;
    float dA = texture2D(uDA, uv).r;
    float dB = texture2D(uDB, uv).r;
    vec2 uvA = uv + par * (dA - 0.45) * 0.028;
    vec2 uvB = uv + par * (dB - 0.45) * 0.028;

    float n = fbm(vUv * vec2(3.0, 2.0) + 7.0) * 0.6 + vUv.x * 0.4;
    float t = smoothstep(n - 0.18, n + 0.18, uMix * 1.36 - 0.18);
    vec2 push = vec2(0.07, 0.0);
    vec3 a = texture2D(uA, uvA - push * t).rgb;
    vec3 b = texture2D(uB, uvB + push * (1.0 - t)).rgb;
    vec3 col = mix(a, b, t);
    col += uGlow * t * (1.0 - t) * 3.2;

    float vig = smoothstep(1.0, 0.3, length(vUv - 0.5));
    col *= mix(0.7, 1.0, vig);
    col += (hash(vUv * uRes + uTime) - 0.5) * 0.03;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function initStages({ canvas, stages, lite, reduced }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5));

  const loader = new THREE.TextureLoader();
  const textures = stages.map((s) => {
    const t = loader.load(s.src, () => (ready = true));
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  });
  const depths = stages.map((s) => {
    const t = loader.load(s.depth);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  });
  let ready = false;

  const uniforms = {
    uA: { value: textures[0] },
    uB: { value: textures[0] },
    uDA: { value: depths[0] },
    uDB: { value: depths[0] },
    uRes: { value: new THREE.Vector2(1, 1) },
    uImg: { value: new THREE.Vector2(16, 9) },
    uMouse: { value: new THREE.Vector2() },
    uGlow: { value: new THREE.Color(stages[0].glow) },
    uMix: { value: 0 },
    uTime: { value: 0 },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false })
    )
  );

  let current = 0;
  let visible = false;
  let raf = 0;
  let last = performance.now();
  const mouse = new THREE.Vector2();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduced) uniforms.uTime.value += dt;
    uniforms.uMouse.value.lerp(mouse, 0.05);
    if (ready) {
      canvas.style.opacity = 1;
      renderer.render(scene, camera);
    }
  }
  canvas.style.opacity = 0;
  canvas.style.transition = 'opacity .5s';

  const onMove = (e) => mouse.set((e.clientX / innerWidth - 0.5) * -1, e.clientY / innerHeight - 0.5);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(tick);

  return {
    go(i) {
      if (i === current) return;
      // settle any running transition onto its target first
      gsap.killTweensOf(uniforms.uMix);
      if (uniforms.uMix.value > 0.5) {
        uniforms.uA.value = uniforms.uB.value;
        uniforms.uDA.value = uniforms.uDB.value;
      }
      uniforms.uMix.value = 0;
      uniforms.uB.value = textures[i];
      uniforms.uDB.value = depths[i];
      uniforms.uGlow.value.set(stages[i].glow);
      current = i;
      gsap.to(uniforms.uMix, {
        value: 1,
        duration: reduced ? 0 : 1.1,
        ease: 'power2.inOut',
        onComplete() {
          uniforms.uA.value = textures[i];
          uniforms.uDA.value = depths[i];
          uniforms.uMix.value = 0;
        },
      });
    },
    setVisible(v) {
      visible = v;
      if (v) {
        last = performance.now();
        resize();
      }
    },
  };
}
