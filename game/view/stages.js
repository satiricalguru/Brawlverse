// The stages as the player sees them. Collision lives in the sim (game/sim/stage.js);
// this draws geometry that matches it, plus everything around it: the key art from the
// landing page as a distant backdrop given depth by its depth map, themed platforms,
// ambient particles and each stage's light.

import * as THREE from 'three';
import { STAGES, SUB } from '../sim/sim.js';

const U = 1 / (SUB * 100); // sub-pixels -> scene units
const DEPTH = 3.2; // how deep the main floor is, front to back

/* ------------------------------------------------------------------ shared GLSL */

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
`;

const loader = new THREE.TextureLoader();
function tex(url, srgb = true) {
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ building blocks */

// the stage's key art, far behind, cropped above the painted platform; the depth map
// moves near parts more than far ones as the camera pans, so it reads as a set
function backdrop(name, { crop = [0, 0.38, 1, 0.62], y = 9, height = 48, fog = '#000000', fogMix = 0.35 } = {}) {
  const aspect = (1672 / 941) * (crop[2] / crop[3]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uArt: { value: tex(`/media/stage_${name}.webp`) },
      uDepth: { value: tex(`/media/stage_${name}_depth.webp`, false) },
      uCam: { value: new THREE.Vector2() },
      uCrop: { value: new THREE.Vector4(...crop) },
      uFog: { value: new THREE.Color(fog) },
      uFogMix: { value: fogMix },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uArt, uDepth;
      uniform vec2 uCam;
      uniform vec4 uCrop;
      uniform vec3 uFog;
      uniform float uFogMix;
      varying vec2 vUv;
      void main() {
        vec2 uv = uCrop.xy + vUv * uCrop.zw;
        float d = texture2D(uDepth, uv).r;
        uv += uCam * (0.002 + d * 0.012);
        uv = clamp(uv, vec2(0.001), vec2(0.999));
        vec3 c = texture2D(uArt, uv).rgb;
        // sink the bottom of the picture into the stage's haze so it meets the floor softly
        float low = 1.0 - smoothstep(0.0, 0.45, vUv.y);
        c = mix(c, uFog, low * uFogMix + 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat);
  m.position.set(0, y, -46);
  m.renderOrder = -10;
  return {
    mesh: m,
    update(camera) {
      mat.uniforms.uCam.value.set(camera.position.x * 0.06, camera.position.y * 0.04);
    },
  };
}

// drifting points (embers, rain, bubbles, snow), animated entirely on the GPU
function particles({ count, box, size, color, vel, sway = 0, additive = true, opacity = 1, stretch = 0 }) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  const s = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * box[0];
    p[i * 3 + 1] = Math.random() * box[1];
    p[i * 3 + 2] = (Math.random() - 0.5) * box[2];
    s[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: new THREE.Vector3(...box) },
      uBase: { value: 0 },
      uVel: { value: new THREE.Vector3(...vel) },
      uSize: { value: size * Math.min(window.devicePixelRatio || 1, 1.75) },
      uColor: { value: new THREE.Color(color) },
      uSway: { value: sway },
      uOpacity: { value: opacity },
      uStretch: { value: stretch },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uSize, uSway, uBase;
      uniform vec3 uBox, uVel;
      varying float vA;
      void main() {
        vec3 q = position + uVel * uTime * (0.6 + aSeed * 0.8);
        q.x += sin(uTime * (0.6 + aSeed) + aSeed * 40.0) * uSway;
        q.y = mod(q.y, uBox.y);
        float fy = q.y / uBox.y;
        q.x = mod(q.x + uBox.x * 0.5, uBox.x) - uBox.x * 0.5;
        q.y += uBase;
        vec4 mv = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.5 + aSeed) * 10.0 / -mv.z;
        vA = smoothstep(0.0, 0.12, fy) * smoothstep(1.0, 0.85, fy);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uStretch;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.x *= 1.0 + uStretch * 6.0;
        float a = smoothstep(0.5, 0.0, length(c)) * vA * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return {
    mesh: pts,
    set base(y) {
      mat.uniforms.uBase.value = y;
    },
    update(t) {
      mat.uniforms.uTime.value = t;
    },
  };
}

// a flat animated surface far below (lava) or around (water) the stage
function surface({ y, size = 220, kind, colorA, colorB, opacity = 1, fog = '#000000' }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(colorA) }, uB: { value: new THREE.Color(colorB) }, uFog: { value: new THREE.Color(fog) } },
    vertexShader: /* glsl */ `
      varying vec2 vW;
      varying float vDist;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xz;
        vec4 mv = viewMatrix * w;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader:
      NOISE +
      /* glsl */ `
      uniform float uTime;
      uniform vec3 uA, uB, uFog;
      varying vec2 vW;
      varying float vDist;
      void main() {
        vec2 p = vW * ${kind === 'lava' ? '0.18' : '0.35'};
        ${
          kind === 'lava'
            ? `
        float n = fbm(p + vec2(uTime * 0.05, uTime * 0.03));
        float veins = smoothstep(0.42, 0.6, fbm(p * 1.7 - vec2(uTime * 0.08, 0.0) + n));
        vec3 c = mix(uA * 0.12, uA * 0.7, n) + uB * veins * 0.9;
        float a = 1.0;`
            : `
        float n = fbm(p + vec2(uTime * 0.07, uTime * 0.05));
        float m = fbm(p * 1.9 - vec2(uTime * 0.06, -uTime * 0.04) + n);
        float caustic = pow(1.0 - abs(m - n) * 2.0, 6.0);
        vec3 c = mix(uA, uB, n) + vec3(0.6, 1.0, 0.95) * caustic * 0.55;
        float a = ${opacity.toFixed(2)};`
        }
        c = mix(c, uFog, smoothstep(18.0, 70.0, vDist));
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return {
    mesh: m,
    update(t) {
      mat.uniforms.uTime.value = t;
    },
  };
}

const glow = (color, intensity = 2.5) =>
  new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, toneMapped: false });

function box(w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = shadow;
  return m;
}

// a chain of links between two points, as one instanced mesh
function chain(from, to, mat, link = 0.2) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a);
  const n = Math.max(2, Math.floor(dir.length() / (link * 1.5)));
  const geo = new THREE.TorusGeometry(link * 0.5, link * 0.13, 6, 12);
  const im = new THREE.InstancedMesh(geo, mat, n);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const spin = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const p = a.clone().lerp(b, i / (n - 1));
    spin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 2) * Math.PI * 0.5);
    const r = q.clone().multiply(spin).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    m.compose(p, r, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, m);
  }
  im.castShadow = true;
  return im;
}

// the sim's geometry in scene units
function layout(st) {
  const m = st.main;
  return {
    w: (m.right - m.left) * U,
    h: (m.top - m.bottom) * U,
    cx: ((m.left + m.right) / 2) * U,
    top: m.top * U,
    plats: st.platforms.map((p) => ({ w: (p.right - p.left) * U, x: ((p.left + p.right) / 2) * U, y: p.top * U })),
  };
}

/* ------------------------------------------------------------------ the stages */

function provingGrounds(st, g) {
  const L = layout(st);
  const rock = new THREE.MeshStandardMaterial({ color: '#2b2735', roughness: 0.78, metalness: 0.15 });
  const topMat = new THREE.MeshStandardMaterial({ color: '#3a3546', roughness: 0.55, metalness: 0.25 });
  const edge = new THREE.MeshBasicMaterial({ color: '#f6e7d4' });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(L.w, L.h, DEPTH), [rock, rock, topMat, rock, rock, rock]);
  slab.position.set(L.cx, L.top - L.h / 2, 0);
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  const ug = new THREE.CylinderGeometry(1, 0.22, 2.4, 4, 1);
  ug.rotateY(Math.PI / 4);
  const under = new THREE.Mesh(ug, rock);
  under.scale.set((L.w * 0.96) / Math.SQRT2, 1, (DEPTH * 0.96) / Math.SQRT2);
  under.position.set(L.cx, L.top - L.h - 1.2, 0);
  g.add(under);
  g.add(box(L.w, 0.03, 0.03, edge, L.cx, L.top - 0.015, DEPTH / 2, false));
  const plat = new THREE.MeshStandardMaterial({ color: '#4a4458', roughness: 0.4, metalness: 0.4 });
  for (const p of L.plats) {
    g.add(box(p.w, 0.1, DEPTH * 0.7, plat, p.x, p.y - 0.05, 0));
    g.add(box(p.w, 0.02, 0.02, edge, p.x, p.y - 0.01, DEPTH * 0.35, false));
  }
  const grid = new THREE.GridHelper(80, 80, '#3b3150', '#1d1828');
  grid.rotation.x = Math.PI / 2;
  grid.position.set(0, 4, -14);
  g.add(grid);
  const floor = new THREE.GridHelper(80, 40, '#2a2238', '#17131f');
  floor.position.set(0, -6, -2);
  g.add(floor);
  return {
    mood: { bg: '#0b0912', fog: ['#0b0912', 18, 46], hemi: ['#9fb2ff', '#1a1020', 0.55], key: ['#fff1e0', 2.4], exposure: 1.05 },
  };
}

// riveted iron plates for the forge slab's faces
function ironTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.max(64, Math.round((1024 * h) / w));
  const x = c.getContext('2d');
  x.fillStyle = '#4a3428';
  x.fillRect(0, 0, c.width, c.height);
  const cols = Math.round(w / 0.9);
  const pw = c.width / cols;
  for (let i = 0; i < cols; i++) {
    const g = x.createLinearGradient(0, 0, 0, c.height);
    const v = 0.85 + ((i * 37) % 10) / 40;
    g.addColorStop(0, `rgba(${110 * v},${78 * v},${58 * v},1)`);
    g.addColorStop(1, `rgba(${52 * v},${36 * v},${28 * v},1)`);
    x.fillStyle = g;
    x.fillRect(i * pw + 3, 3, pw - 6, c.height - 6);
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.fillRect(i * pw, 0, 3, c.height);
    x.fillStyle = 'rgba(255,190,140,0.25)';
    for (const ry of [10, c.height - 12]) for (let k = 0; k < 4; k++) {
      x.beginPath();
      x.arc(i * pw + 12 + (k * (pw - 24)) / 3, ry, 3.2, 0, Math.PI * 2);
      x.fill();
    }
  }
  // rust streaks
  for (let k = 0; k < 160; k++) {
    x.fillStyle = `rgba(${120 + Math.random() * 60},${50 + Math.random() * 20},20,${Math.random() * 0.12})`;
    x.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 3, 6 + Math.random() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function cinderForge(st, g) {
  const L = layout(st);
  const iron = new THREE.MeshStandardMaterial({ color: '#3d2c22', roughness: 0.72, metalness: 0.6 });
  const face = new THREE.MeshStandardMaterial({ map: ironTexture(L.w, L.h), roughness: 0.65, metalness: 0.55 });
  const plate = new THREE.MeshStandardMaterial({ color: '#56423a', roughness: 0.6, metalness: 0.55 });
  const lava = glow('#ff6a1a', 3);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(L.w, L.h, DEPTH), [iron, iron, plate, iron, face, face]);
  slab.position.set(L.cx, L.top - L.h / 2, 0);
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  // molten seams along the edges and running down both ends
  g.add(box(L.w, 0.05, 0.07, lava, L.cx, L.top - 0.03, DEPTH / 2, false));
  g.add(box(L.w, 0.05, 0.07, lava, L.cx, L.top - 0.03, -DEPTH / 2, false));
  for (const s of [-1, 1]) g.add(box(0.12, L.h + 1.2, 0.1, lava, L.cx + s * (L.w / 2 - 0.15), L.top - L.h / 2 - 0.6, DEPTH / 2 + 0.02, false));
  // truss underneath
  const beamY = L.top - L.h - 0.35;
  g.add(box(L.w * 0.92, 0.3, DEPTH * 0.7, iron, L.cx, beamY, 0));
  for (let i = 0; i < 6; i++) {
    const x = L.cx - L.w * 0.4 + (i * L.w * 0.8) / 5;
    const b = box(0.12, 1.1, 0.12, iron, x, L.top - L.h - 0.1, DEPTH * 0.3);
    b.rotation.z = (i % 2 ? 1 : -1) * 0.6;
    g.add(b);
  }
  // the gear on the front
  const gear = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 24), iron);
  gear.position.set(L.cx, L.top - L.h * 0.55, DEPTH / 2 + 0.06);
  g.add(gear);
  g.add(box(0.18, 0.18, 0.06, lava, L.cx, L.top - L.h * 0.55, DEPTH / 2 + 0.1, false));
  // chains up into the dark from each corner
  const ch = new THREE.MeshStandardMaterial({ color: '#5a4436', roughness: 0.5, metalness: 0.85 });
  for (const s of [-1, 1]) {
    g.add(chain([L.cx + s * (L.w / 2 - 0.2), L.top + 0.05, -DEPTH / 2 + 0.3], [L.cx + s * (L.w / 2 + 2.2), 15, -3], ch, 0.36));
  }
  // hanging grates
  for (const p of L.plats) {
    g.add(box(p.w, 0.12, DEPTH * 0.55, iron, p.x, p.y - 0.06, 0));
    g.add(box(p.w, 0.03, 0.04, lava, p.x, p.y - 0.015, DEPTH * 0.28, false));
    for (const s of [-1, 1]) g.add(chain([p.x + s * (p.w / 2 - 0.12), p.y, -0.3], [p.x + s * (p.w / 2 - 0.2), p.y + 7, -0.8], ch, 0.24));
  }
  const sea = surface({ y: -11, kind: 'lava', colorA: '#ff3c0a', colorB: '#ffb04a', fog: '#2a0c05' });
  g.add(sea.mesh);
  const under = new THREE.PointLight('#ff5a14', 70, 26, 1.5);
  under.position.set(0, -4.5, 1.5);
  g.add(under);
  const embers = particles({ count: 260, box: [34, 16, 14], size: 1.6, color: '#ff8a3a', vel: [0.15, 1.1, 0], sway: 0.6 });
  embers.base = -6;
  g.add(embers.mesh);
  const bg = backdrop('cinder', { fog: '#2a0c05', y: 8 });
  g.add(bg.mesh);
  return {
    mood: { bg: '#1a0805', fog: ['#2a0c05', 22, 62], hemi: ['#ff9a5a', '#200805', 0.45], key: ['#ffb27a', 2.1], exposure: 1.0 },
    update(t, camera) {
      sea.update(t);
      embers.update(t);
      bg.update(camera);
      under.intensity = 55 + Math.sin(t * 2.3) * 8 + Math.sin(t * 5.1) * 4;
    },
  };
}

function helipadTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#26262e';
  x.fillRect(0, 0, 1024, 256);
  // panel seams
  x.strokeStyle = 'rgba(0,0,0,0.5)';
  x.lineWidth = 3;
  for (let i = 0; i <= 1024; i += 128) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, 256);
    x.stroke();
  }
  x.beginPath();
  x.moveTo(0, 128);
  x.lineTo(1024, 128);
  x.stroke();
  // landing ring and letter
  x.strokeStyle = '#d9a52b';
  x.lineWidth = 14;
  x.beginPath();
  x.ellipse(512, 128, 300, 96, 0, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = '#e8e8ea';
  x.fillRect(440, 70, 34, 116);
  x.fillRect(550, 70, 34, 116);
  x.fillRect(440, 112, 144, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function neonAbyss(st, g) {
  const L = layout(st);
  const metal = new THREE.MeshStandardMaterial({ color: '#24242c', roughness: 0.38, metalness: 0.85 });
  const top = new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.16, metalness: 0.55 });
  const pink = glow('#ff3df0', 3.2);
  const cyan = glow('#2de2ff', 3);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(L.w, L.h, DEPTH), [metal, metal, top, metal, metal, metal]);
  slab.position.set(L.cx, L.top - L.h / 2, 0);
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  g.add(box(L.w, 0.05, 0.05, pink, L.cx, L.top - L.h * 0.45, DEPTH / 2 + 0.01, false));
  g.add(box(L.w * 0.9, 0.03, 0.03, cyan, L.cx, L.top - L.h - 0.02, DEPTH / 2 - 0.2, false));
  // pylons down into the city
  for (const s of [-1, 1]) {
    g.add(box(0.5, 20, 0.5, metal, L.cx + s * L.w * 0.32, L.top - L.h - 10, -0.4));
    g.add(box(0.06, 18, 0.06, s < 0 ? pink : cyan, L.cx + s * L.w * 0.32, L.top - L.h - 10, -0.12, false));
  }
  // beacons on the corners
  const beaconMat = glow('#ff2a3a', 3);
  for (const s of [-1, 1]) for (const z of [-1, 1]) g.add(box(0.1, 0.12, 0.1, beaconMat, L.cx + s * (L.w / 2 - 0.08), L.top + 0.06, z * (DEPTH / 2 - 0.08), false));
  // the drone pad
  for (const p of L.plats) {
    g.add(box(p.w, 0.1, DEPTH * 0.5, metal, p.x, p.y - 0.05, 0));
    g.add(box(p.w, 0.025, 0.025, cyan, p.x, p.y - 0.012, DEPTH * 0.25, false));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 32), cyan);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, p.y - 0.25, 0);
    g.add(ring);
  }
  const rain = particles({ count: 900, box: [36, 18, 16], size: 0.9, color: '#a8dcff', vel: [-0.6, -14, 0], additive: true, opacity: 0.4, stretch: 1 });
  rain.base = -4;
  g.add(rain.mesh);
  const city = new THREE.PointLight('#ff3df0', 30, 24, 1.6);
  city.position.set(-6, -4, 2);
  const city2 = new THREE.PointLight('#2de2ff', 30, 24, 1.6);
  city2.position.set(6, -4, 2);
  g.add(city, city2);
  const bg = backdrop('neon', { fog: '#1a0b2a', y: 8, crop: [0, 0.47, 1, 0.53] });
  g.add(bg.mesh);
  return {
    mood: { bg: '#0a0614', fog: ['#1a0b2a', 22, 62], hemi: ['#ff7be3', '#06121a', 0.45], key: ['#d8e6ff', 1.8], exposure: 1.05 },
    update(t, camera) {
      rain.update(t);
      bg.update(camera);
      beaconMat.emissiveIntensity = 1.5 + 2 * (0.5 + 0.5 * Math.sin(t * 4));
    },
  };
}

function sunkenColosseum(st, g) {
  const L = layout(st);
  const stone = new THREE.MeshStandardMaterial({ color: '#6f7d79', roughness: 0.9, metalness: 0.05 });
  const wall = new THREE.MeshStandardMaterial({ map: blockTexture({ base: '#8a9a94', w: L.w * 3, h: L.h, rows: 2, moss: 1.4, repeat: 2 }), roughness: 0.9 });
  const floor = new THREE.MeshStandardMaterial({ color: '#7d8b86', roughness: 0.82 });
  const moss = new THREE.MeshStandardMaterial({ color: '#3e5a3c', roughness: 0.95 });
  const gold = glow('#ffd27a', 1.2);
  // a round arena floor, squashed to the stage's depth
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(L.w / 2, L.w / 2 - 0.15, L.h, 64), [wall, floor, stone]);
  disc.scale.z = DEPTH / L.w;
  disc.position.set(L.cx, L.top - L.h / 2, 0);
  disc.castShadow = disc.receiveShadow = true;
  g.add(disc);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(L.w / 2 - 0.15, L.w / 2 - 0.4, 0.5, 64), moss);
  lower.scale.z = DEPTH / L.w;
  lower.position.set(L.cx, L.top - L.h - 0.25, 0);
  g.add(lower);
  // a gold ring inlaid in the floor
  const ring = new THREE.Mesh(new THREE.RingGeometry(L.w * 0.3, L.w * 0.31, 96), gold);
  ring.rotation.x = -Math.PI / 2;
  ring.scale.y = DEPTH / L.w;
  ring.position.set(L.cx, L.top + 0.004, 0);
  g.add(ring);
  // arches down into the water along the front
  for (let i = 0; i < 7; i++) {
    const x = L.cx - L.w * 0.42 + (i * L.w * 0.84) / 6;
    g.add(box(0.32, 1.4, 0.32, stone, x, L.top - L.h - 0.7, DEPTH * 0.3));
  }
  // broken pillars holding up the side platforms; a floating arch stone up top
  for (const p of L.plats) {
    const high = p.y > 2.5;
    g.add(box(p.w, 0.16, DEPTH * 0.5, stone, p.x, p.y - 0.08, 0));
    g.add(box(p.w * 0.9, 0.05, DEPTH * 0.45, moss, p.x, p.y - 0.18, 0));
    if (!high) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, p.y + 1.1, 16), stone);
      col.position.set(p.x, (p.y - 1.1) / 2 - 0.1, -0.2);
      col.castShadow = true;
      g.add(col);
    }
  }
  const water = surface({ y: -0.95, kind: 'water', colorA: '#05343c', colorB: '#0d7f8a', opacity: 0.86, fog: '#06303a' });
  g.add(water.mesh);
  const bubbles = particles({ count: 160, box: [30, 12, 10], size: 1.1, color: '#8ff6ff', vel: [0, 0.5, 0], sway: 0.25, opacity: 0.7 });
  bubbles.base = -1;
  g.add(bubbles.mesh);
  // shafts of light from the surface far above
  const rayMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      void main(){
        float a = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x) * smoothstep(0.0, 0.6, vUv.y);
        a *= 0.08 + 0.04 * sin(uTime * 0.7 + vUv.y * 3.0);
        gl_FragColor = vec4(vec3(0.6, 1.0, 0.95) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (const [x, r] of [
    [-3, 0.18],
    [1.5, -0.12],
    [5, -0.25],
  ]) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 26), rayMat);
    ray.position.set(x, 9, -4);
    ray.rotation.z = r;
    g.add(ray);
  }
  const bg = backdrop('sunken', { fog: '#06303a', y: 8, crop: [0, 0.4, 1, 0.6] });
  g.add(bg.mesh);
  return {
    mood: { bg: '#031a1f', fog: ['#06303a', 20, 58], hemi: ['#86fff0', '#04161a', 0.6], key: ['#dcfff7', 2.0], exposure: 1.05 },
    update(t, camera) {
      water.update(t);
      bubbles.update(t);
      rayMat.uniforms.uTime.value = t;
      bg.update(camera);
    },
  };
}

function frostspireSummit(st, g) {
  const L = layout(st);
  const stone = new THREE.MeshStandardMaterial({ color: '#59616f', roughness: 0.85, metalness: 0.05 });
  const snow = new THREE.MeshStandardMaterial({ color: '#eef4ff', roughness: 0.95 });
  const ice = new THREE.MeshStandardMaterial({ color: '#9fdcff', roughness: 0.15, metalness: 0.1, emissive: '#2a90d0', emissiveIntensity: 0.25, transparent: true, opacity: 0.7 });
  const face = new THREE.MeshStandardMaterial({ map: blockTexture({ base: '#6c7686', w: L.w, h: L.h, rows: 1 }), roughness: 0.85 });
  g.add(box(L.w, L.h - 0.08, DEPTH, [stone, stone, stone, stone, face, face], L.cx, L.top - 0.08 - (L.h - 0.08) / 2, 0));
  g.add(box(L.w + 0.08, 0.1, DEPTH + 0.08, snow, L.cx, L.top - 0.05, 0));
  // icicles under the front and back edges
  const cone = new THREE.ConeGeometry(0.045, 1, 5);
  cone.rotateX(Math.PI);
  const n = 90;
  const icicles = new THREE.InstancedMesh(cone, ice, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const len = 0.15 + (((i * 7919) % 100) / 100) ** 2 * 0.7;
    const x = L.cx - L.w / 2 + 0.1 + ((i % 45) / 44) * (L.w - 0.2) + (((i * 31) % 10) - 5) * 0.01;
    const z = i < 45 ? DEPTH / 2 - 0.05 : -DEPTH / 2 + 0.05;
    m.compose(new THREE.Vector3(x, L.top - L.h - len / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1));
    icicles.setMatrixAt(i, m);
  }
  g.add(icicles);
  // glowing crystal clusters under each end
  const crystal = new THREE.MeshStandardMaterial({ color: '#6fd2ff', emissive: '#2fa8ff', emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.75 });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8 + k * 0.25, 6), crystal);
      c.position.set(L.cx + s * (L.w / 2 - 0.5 - k * 0.35), L.top - L.h - 0.9 - k * 0.2, 0.3 - k * 0.3);
      c.rotation.z = Math.PI + s * (0.25 + k * 0.12);
      g.add(c);
    }
  }
  for (const p of L.plats) g.add(box(p.w, 0.14, DEPTH * 0.45, ice, p.x, p.y - 0.07, 0));
  // braziers at either end of the bridge
  const flames = [];
  for (const s of [-1, 1]) {
    const light = new THREE.PointLight('#ffb35a', 10, 7, 1.8);
    light.position.set(L.cx + s * (L.w / 2 - 0.3), L.top + 0.9, -DEPTH / 2 + 0.2);
    g.add(light);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 8), glow('#ffa04a', 3));
    fire.position.copy(light.position).add(new THREE.Vector3(0, -0.45, 0));
    g.add(fire);
    g.add(box(0.3, 0.5, 0.3, stone, fire.position.x, L.top + 0.2, fire.position.z));
    flames.push({ light, fire });
  }
  const flakes = particles({ count: 500, box: [36, 16, 14], size: 1.3, color: '#ffffff', vel: [0.8, -1.2, 0], sway: 0.8, additive: false, opacity: 0.85 });
  flakes.base = -4;
  g.add(flakes.mesh);
  const bg = backdrop('frostspire', { fog: '#16203a', y: 9, crop: [0, 0.42, 1, 0.58] });
  g.add(bg.mesh);
  return {
    mood: { bg: '#060a1a', fog: ['#16203a', 22, 62], hemi: ['#a8d6ff', '#0a1020', 0.55], key: ['#e8f1ff', 2.1], exposure: 1.05 },
    update(t, camera) {
      flakes.update(t);
      bg.update(camera);
      for (const [i, f] of flames.entries()) {
        const k = 0.85 + 0.15 * Math.sin(t * 13 + i * 2) * Math.sin(t * 7.3 + i);
        f.light.intensity = 10 * k;
        f.fire.scale.y = k;
      }
    },
  };
}

// cut stone blocks in running bond, for the colosseum and the summit bridge
function blockTexture({ base, w, h, rows = 3, moss = 0, repeat = 1 }) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const x = c.getContext('2d');
  const col = new THREE.Color(base);
  x.fillStyle = '#1a1d22';
  x.fillRect(0, 0, 1024, 256);
  const rh = 256 / rows;
  const bw = rh * 2.2;
  for (let r = 0; r < rows; r++) {
    for (let i = -1; i * bw < 1024 + bw; i++) {
      const v = 0.78 + Math.random() * 0.3;
      x.fillStyle = `rgb(${(col.r * 255 * v) | 0},${(col.g * 255 * v) | 0},${(col.b * 255 * v) | 0})`;
      const ox = (r % 2) * bw * 0.5;
      x.fillRect(i * bw + ox + 3, r * rh + 3, bw - 6, rh - 6);
      // chips and wear
      x.fillStyle = 'rgba(0,0,0,0.18)';
      for (let k = 0; k < 6; k++) x.fillRect(i * bw + ox + Math.random() * bw, r * rh + Math.random() * rh, 2 + Math.random() * 8, 1 + Math.random() * 3);
    }
  }
  if (moss) {
    for (let k = 0; k < 220 * moss; k++) {
      x.fillStyle = `rgba(${60 + Math.random() * 40},${110 + Math.random() * 50},${60 + Math.random() * 30},${0.15 + Math.random() * 0.25})`;
      const px_ = Math.random() * 1024;
      x.fillRect(px_, 0, 2 + Math.random() * 5, 30 + Math.random() * 140);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(repeat * Math.max(1, Math.round(w / 6)), 1);
  t.anisotropy = 8;
  return t;
}

const BUILDERS = [provingGrounds, cinderForge, neonAbyss, sunkenColosseum, frostspireSummit];

/** Build stage `id` into a fresh group. Returns { group, mood, update(t, camera), dispose() }. */
export function buildStage(id) {
  const st = STAGES[id];
  const group = new THREE.Group();
  group.name = `stage:${st.name}`;
  const built = BUILDERS[id](st, group);
  return {
    group,
    mood: built.mood,
    update: built.update || (() => {}),
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          for (const v of Object.values(m.uniforms || {})) v.value?.isTexture && v.value.dispose();
          m.map?.dispose();
          m.dispose();
        }
      });
    },
  };
}
