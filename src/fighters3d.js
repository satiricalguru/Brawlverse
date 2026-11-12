import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import gsap from 'gsap';

// Fighters are rigged, animated GLB characters (KayKit Adventurers, CC0 - see public/models/kaykit/LICENSE.txt).
// They idle, play a signature move when selected, spin on a turntable, and can be dragged.

const DUST_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPx;
  varying float vA;
  void main() {
    vec3 p = position;
    float t = uTime * (0.05 + aSeed.x * 0.12);
    p.y = mod(p.y + t + 4.0, 8.0) - 4.0;
    p.x += sin(t * 3.0 + aSeed.y * 30.0) * 0.18;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (4.0 + aSeed.z * 22.0) * uPx / -mv.z;
    vA = (0.25 + aSeed.w * 0.75) * smoothstep(-4.0, -2.4, p.y) * smoothstep(4.0, 2.0, p.y);
  }
`;
const DUST_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    vec3 c = uColor * a * vA;
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;

const DISC_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float glow = smoothstep(1.0, 0.0, r);
    float ring = smoothstep(0.02, 0.0, abs(r - 0.62)) + smoothstep(0.012, 0.0, abs(r - 0.82)) * 0.6;
    float pulse = smoothstep(0.03, 0.0, abs(r - fract(uTime * 0.18))) * (1.0 - r);
    vec3 c = uColor * (glow * glow * 0.5 + ring * 0.8 + pulse * 0.7) * smoothstep(1.0, 0.85, r);
    gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
  }
`;
const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function initFighters({ canvas, fighters, lite, reduced }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 10);

  const rig = new THREE.Group();
  const turn = new THREE.Group();
  rig.add(turn);
  scene.add(rig);

  const H = 4.9;
  const color = new THREE.Color(fighters[0].color);

  // lighting: soft studio reflections so armour and metal read properly, then key and rim lights
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x1a1420, 1.5));
  const key = new THREE.DirectionalLight(0xfff4e6, 3.4);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rimL = new THREE.DirectionalLight(color, 2.2);
  rimL.position.set(-5, 2.5, -4);
  scene.add(rimL);
  const rimR = new THREE.DirectionalLight(color, 1.2);
  rimR.position.set(5, 1, -3);
  scene.add(rimR);
  const under = new THREE.PointLight(color, 6, 9, 1.6);
  under.position.set(0, -H / 2 + 0.3, 1.2);
  rig.add(under);
  const lightColors = [rimL.color, rimR.color, under.color];

  // models: first one now, the rest right after
  const loader = new GLTFLoader();
  const models = fighters.map(() => null);
  const mixers = fighters.map(() => null);
  function load(i) {
    return new Promise((res) => {
      loader.load(
        fighters[i].model,
        (g) => {
          const f = fighters[i];
          const m = g.scene;
          m.traverse((o) => {
            if (f.hide?.includes(o.name)) o.visible = false;
            if (o.isMesh) {
              o.frustumCulled = false; // skinned bounds are unreliable while animating
              if (f.flat) {
                o.material.roughness = 0.72;
                o.material.metalness = 0.05;
              }
            }
          });
          // normalise: stand on the disc, centred, at a common height
          const box = new THREE.Box3().setFromObject(m);
          const size = box.getSize(new THREE.Vector3());
          const k = (H * 0.86) / size.y;
          m.scale.setScalar(k);
          m.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k - H / 2, -(box.min.z + size.z / 2) * k);
          const holder = new THREE.Group();
          holder.add(m);
          holder.visible = i === current;
          holder.scale.setScalar(i === current ? 1 : 0.001);
          turn.add(holder);

          const mixer = new THREE.AnimationMixer(m);
          const clip = (n) => g.animations.find((c) => c.name === n);
          const idle = mixer.clipAction(clip(f.idle) || clip('Idle') || g.animations[0]);
          idle.play();
          const introClip = clip(f.intro);
          const intro = introClip ? mixer.clipAction(introClip) : null;
          if (intro) {
            intro.setLoop(THREE.LoopOnce, 1);
            intro.clampWhenFinished = false;
            mixer.addEventListener('finished', () => {
              intro.fadeOut(0.25);
              idle.reset().fadeIn(0.25).play();
            });
          }
          mixers[i] = {
            mixer,
            strike() {
              if (!intro || reduced) return;
              idle.fadeOut(0.15);
              intro.reset().fadeIn(0.15).play();
            },
          };
          models[i] = holder;
          res();
        },
        undefined,
        res
      );
    });
  }

  // ground disc
  const discU = { uColor: { value: color }, uTime: { value: 0 } };
  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 7.5),
    new THREE.ShaderMaterial({
      uniforms: discU,
      vertexShader: UV_VERT,
      fragmentShader: DISC_FRAG,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -H / 2 + 0.02;
  rig.add(disc);

  // dust
  const N = lite ? 120 : 300;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 12;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 7;
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const dust = new THREE.Points(
    dg,
    new THREE.ShaderMaterial({
      uniforms: { uTime: discU.uTime, uPx: { value: dpr }, uColor: { value: color } },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  dust.frustumCulled = false;
  scene.add(dust);

  // ---- state ----
  let current = 0;
  let visible = false;
  let last = performance.now();
  const state = { spin: -0.4, vel: 0, scroll: 0 };
  const AUTO = reduced ? 0 : 0.5; // rad/s
  const mouse = new THREE.Vector2();
  const mouseS = new THREE.Vector2();
  let dragging = false;
  let px = 0;

  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visW = visH * camera.aspect;
    const W = (H * 896) / 1200;
    if (camera.aspect < 0.9) {
      rig.scale.setScalar(Math.min(1, (visW * 1.05) / W, (visH * 0.56) / H));
      rig.position.set(0, visH * 0.2, 0);
    } else {
      rig.scale.setScalar(Math.min(1.08, (visH * 0.9) / H));
      rig.position.set(Math.min(visW * 0.2, 2.6), -0.05, 0);
    }
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (discU.uTime.value += reduced ? 0 : dt);

    // full turntable: constant spin, plus whatever a drag threw in, easing back to the base rate
    if (!dragging) {
      state.vel += (AUTO - state.vel) * Math.min(1, dt * 1.6);
      state.spin += state.vel * dt;
    }
    mixers[current]?.mixer.update(dt);
    mouseS.lerp(mouse, 0.06);
    turn.rotation.y = state.spin + state.scroll;
    turn.position.y = reduced ? 0 : Math.sin(t * 0.9) * 0.05;
    camera.position.x = mouseS.x * 0.6;
    camera.position.y = -mouseS.y * 0.35;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    px = e.clientX;
    state.vel = 0;
  });
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener(
    'pointermove',
    (e) => {
      mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
      if (!dragging) return;
      const d = (e.clientX - px) * 0.01;
      state.spin += d;
      state.vel = d * 60;
      px = e.clientX;
    },
    { passive: true }
  );
  window.addEventListener('resize', layout);
  layout();
  requestAnimationFrame(tick);

  load(0).then(async () => {
    for (let i = 1; i < fighters.length; i++) await load(i);
  });

  return {
    go(i, dir = 1) {
      if (i === current) return;
      const from = models[current];
      current = i;
      const c = new THREE.Color(fighters[i].color);
      gsap.to(color, { r: c.r, g: c.g, b: c.b, duration: 0.8, onUpdate: () => lightColors.forEach((l) => l.copy(color)) });
      models.forEach((m, k) => {
        if (!m) return;
        gsap.killTweensOf(m.scale);
        if (k !== i && m !== from) m.visible = false;
      });
      const show = () => {
        const to = models[current];
        if (!to || current !== i) return;
        to.visible = true;
        if (reduced) return to.scale.setScalar(1);
        state.spin = -0.5; // enter facing the camera
        state.vel = dir * 3;
        mixers[current]?.strike();
        gsap.fromTo(to.scale, { x: 0.6, y: 0.6, z: 0.6 }, { x: 1, y: 1, z: 1, duration: 0.9, ease: 'expo.out' });
      };
      if (!from || reduced) {
        if (from) from.visible = false;
        return show();
      }
      state.vel = dir * 8;
      gsap.to(from.scale, {
        x: 0.001,
        y: 0.001,
        z: 0.001,
        duration: 0.32,
        ease: 'power2.in',
        onComplete() {
          from.visible = false;
          show();
        },
      });
    },
    setScroll(v) {
      state.scroll = v;
    },
    setVisible(v) {
      visible = v;
      if (v) {
        last = performance.now();
        layout();
      }
    },
  };
}
