// Draws the sim state with Three.js. It only reads the state: everything here (camera,
// shake, flashes, squash) is presentation and can use floats and randomness freely.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ACT, FIGHTERS, STAGES, SUB, SHIELD_MAX, activeHitboxes, heightOf, intangible } from '../sim/sim.js';

const U = 1 / (SUB * 100); // sub-pixels -> scene units (100 px = 1 unit)

export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0912');
  scene.fog = new THREE.Fog('#0b0912', 18, 46);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(0, 2.2, 18);

  /* ---------- light ---------- */
  scene.add(new THREE.HemisphereLight('#9fb2ff', '#1a1020', 0.55));
  const key = new THREE.DirectionalLight('#fff1e0', 2.4);
  key.position.set(4, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 1024);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 6, bottom: -3, near: 1, far: 30 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rimL = new THREE.PointLight(FIGHTERS[0].color, 18, 30, 2);
  rimL.position.set(-9, 4, -3);
  const rimR = new THREE.PointLight(FIGHTERS[1].color, 18, 30, 2);
  rimR.position.set(9, 4, -3);
  scene.add(rimL, rimR);

  /* ---------- stage ---------- */
  const st = STAGES[0];
  const stage = new THREE.Group();
  scene.add(stage);
  const rock = new THREE.MeshStandardMaterial({ color: '#2b2735', roughness: 0.78, metalness: 0.15 });
  const topMat = new THREE.MeshStandardMaterial({ color: '#3a3546', roughness: 0.55, metalness: 0.25 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: '#f6e7d4' });
  const DEPTH = 3.2;
  {
    const m = st.main;
    const w = (m.right - m.left) * U;
    const h = (m.top - m.bottom) * U;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, DEPTH), [rock, rock, topMat, rock, rock, rock]);
    slab.position.set(((m.left + m.right) / 2) * U, (m.top * U) - h / 2, 0);
    slab.castShadow = slab.receiveShadow = true;
    stage.add(slab);
    // tapering underside so it reads as a floating island, not a box
    // (a 4-sided cylinder turned 45° is a square frustum whose top is √2 wide; scale it to the slab)
    const ug = new THREE.CylinderGeometry(1, 0.22, 2.4, 4, 1);
    ug.rotateY(Math.PI / 4);
    const under = new THREE.Mesh(ug, rock);
    under.scale.set((w * 0.96) / Math.SQRT2, 1, (DEPTH * 0.96) / Math.SQRT2);
    under.position.set(slab.position.x, m.bottom * U - 1.2, 0);
    under.castShadow = true;
    stage.add(under);
    // a lit lip along the front edge of the floor
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.03), edgeMat);
    lip.position.set(slab.position.x, m.top * U - 0.015, DEPTH / 2);
    stage.add(lip);
    for (const l of st.ledges) {
      const nub = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, DEPTH + 0.02), edgeMat);
      nub.position.set(l.x * U, l.y * U - 0.04, 0);
      stage.add(nub);
    }
  }
  const platMat = new THREE.MeshStandardMaterial({
    color: '#4a4458',
    roughness: 0.4,
    metalness: 0.4,
    transparent: true,
    opacity: 0.92,
  });
  for (const p of st.platforms) {
    const w = (p.right - p.left) * U;
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, DEPTH * 0.7), platMat);
    g.position.set(((p.left + p.right) / 2) * U, p.top * U - 0.05, 0);
    g.castShadow = g.receiveShadow = true;
    stage.add(g);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 0.02), edgeMat);
    lip.position.set(g.position.x, p.top * U - 0.01, DEPTH * 0.35);
    stage.add(lip);
  }

  // backdrop: a faint grid wall and floor far behind, like a training hall
  const grid = new THREE.GridHelper(80, 80, '#3b3150', '#1d1828');
  grid.rotation.x = Math.PI / 2;
  grid.position.set(0, 4, -14);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
  const floorGrid = new THREE.GridHelper(80, 40, '#2a2238', '#17131f');
  floorGrid.position.set(0, -6, -2);
  scene.add(floorGrid);

  // blast zone outline (debug view only)
  const b = st.blast;
  const blastLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      [
        [b.left, b.bottom],
        [b.right, b.bottom],
        [b.right, b.top],
        [b.left, b.top],
      ].map(([x, y]) => new THREE.Vector3(x * U, y * U, 0))
    ),
    new THREE.LineDashedMaterial({ color: '#ff4f8b', dashSize: 0.3, gapSize: 0.2 })
  );
  blastLine.computeLineDistances();
  blastLine.visible = false;
  scene.add(blastLine);

  /* ---------- fighters ---------- */
  const fighters = FIGHTERS.slice(0, 2).map((c, i) => {
    const color = new THREE.Color(c.color);
    const R = c.radius * U;
    const H = c.height * U;
    const root = new THREE.Group();
    const body = new THREE.Group(); // squash and stretch happen here, around the feet
    root.add(body);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.38,
      metalness: 0.1,
      emissive: color,
      emissiveIntensity: 0.12,
      transparent: true,
    });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(R, H - 2 * R, 8, 20), mat);
    capsule.position.y = H / 2;
    capsule.castShadow = true;
    body.add(capsule);
    // visor on the facing side, so you can read which way a fighter looks
    const visorMat = new THREE.MeshBasicMaterial({ color: '#fff7ea' });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, R * 1.3), visorMat);
    visor.position.set(R * 0.85, H - R * 1.05, 0);
    body.add(visor);
    // player marker above the head
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.16, 3),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    marker.rotation.z = Math.PI;
    marker.position.y = H + 0.32;
    root.add(marker);
    // shield bubble
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    shield.position.y = H * 0.5;
    root.add(shield);
    // respawn halo
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.04;
    root.add(halo);
    // hurt capsule (debug)
    const hurt = new THREE.Mesh(
      new THREE.CapsuleGeometry(R, H - 2 * R, 4, 12),
      new THREE.MeshBasicMaterial({ color: '#ffd84d', wireframe: true, transparent: true, opacity: 0.35 })
    );
    hurt.position.y = H / 2;
    hurt.visible = false;
    root.add(hurt);
    scene.add(root);
    return { root, body, mat, capsule, visor, marker, shield, halo, hurt, color, H, seenHit: -1, seenKo: -1, squash: 0 };
  });

  // hitbox pool (debug)
  const hitPool = Array.from({ length: 8 }, () => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.5, depthTest: false, toneMapped: false })
    );
    m.renderOrder = 10;
    m.visible = false;
    scene.add(m);
    return m;
  });

  /* ---------- effects ---------- */
  const sparkGeo = new THREE.RingGeometry(0.7, 1, 40);
  const effects = [];
  function burst(x, y, color, size, life) {
    const m = new THREE.Mesh(
      sparkGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    m.position.set(x, y, 0.6);
    scene.add(m);
    effects.push({ m, age: 0, life, size });
  }

  /* ---------- camera ---------- */
  const cam = { x: 0, y: 1.8, z: 16 };
  let shake = 0;
  let debug = false;
  let lastT = performance.now();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function frameCamera(state, dt) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const f of state.fighters) {
      if (f.action === ACT.DEAD) continue;
      const x = f.x * U;
      const y = f.y * U;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + 1.5);
    }
    if (minX === Infinity) {
      minX = -3;
      maxX = 3;
      minY = 0;
      maxY = 2;
    }
    // keep a little of the stage in frame so the eye always has the floor as an anchor
    // and leave room under the floor for the HUD cards
    minX = Math.min(minX, -4.2);
    maxX = Math.max(maxX, 4.2);
    minY = Math.min(minY, -2.2);
    maxY = Math.max(maxY, 2.4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = maxX - minX + 4.5;
    const h = maxY - minY + 3;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const z = THREE.MathUtils.clamp(Math.max(h / (2 * t), w / (2 * t * camera.aspect)), 12, 34);
    const k = 1 - Math.exp(-dt * 4.5);
    cam.x += (cx * 0.85 - cam.x) * k;
    cam.y += (cy + 0.4 - cam.y) * k;
    cam.z += (z - cam.z) * k;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    camera.position.set(cam.x + sx, cam.y + sy + cam.z * 0.06, cam.z);
    camera.lookAt(cam.x + sx * 0.5, cam.y + sy * 0.5, 0);
    shake *= Math.exp(-dt * 9);
  }

  function drawFighter(state, f, v, dt, now) {
    const c = FIGHTERS[f.char];
    const dead = f.action === ACT.DEAD;
    v.root.visible = !dead;

    // KO: a burst at the blast line, a hard shake
    if (f.koFrame !== v.seenKo && f.koFrame >= 0) {
      v.seenKo = f.koFrame;
      burst(f.koX * U, f.koY * U, v.color, 4, 0.9);
      burst(f.koX * U, f.koY * U, '#ffffff', 2.4, 0.5);
      shake = Math.max(shake, 0.6);
    }
    if (dead) return;

    // a new hit: spark, flash, shake scaled by knockback
    if (f.hitFrame !== v.seenHit && f.hitFrame >= 0) {
      v.seenHit = f.hitFrame;
      const hx = f.x * U;
      const hy = f.y * U + v.H * 0.55;
      burst(hx, hy, f.blocked ? v.color : '#fff1c9', f.blocked ? 0.7 : 0.6 + f.lastKb / 160, 0.32);
      shake = Math.max(shake, Math.min(0.5, f.lastKb / 300));
    }

    let x = f.x * U;
    const y = f.y * U;
    if (f.hitlag > 0 && f.action === ACT.HITSTUN) x += (Math.random() - 0.5) * 0.08;
    v.root.position.set(x, y, 0);
    v.body.rotation.y = f.facing > 0 ? 0 : Math.PI;

    // squash on landing and jump-squat, stretch while rising fast
    let sy = 1;
    if (f.action === ACT.CROUCH) sy = heightOf(f) / c.height;
    else if (f.action === ACT.SQUAT) sy = 0.86;
    else if (f.action === ACT.LAND) sy = 0.82 + 0.18 * Math.min(1, f.af / Math.max(1, f.lag));
    else if (!f.grounded && f.vy > 0) sy = 1 + Math.min(0.12, f.vy / (SUB * 120));
    v.squash += (sy - v.squash) * (1 - Math.exp(-dt * 30));
    v.body.scale.set(1 / Math.sqrt(v.squash), v.squash, 1 / Math.sqrt(v.squash));

    // tumble spin while launched hard
    v.body.rotation.z = f.action === ACT.HITSTUN && f.lastKb > 80 ? Math.sin(now * 0.02) * 0.5 : 0;

    // material: white flash on hit, fade while intangible, pulse while charging
    const flash = state.frame - f.hitFrame < 6 && !f.blocked;
    v.mat.emissive.set(flash ? '#ffffff' : v.color);
    let glow = 0.12;
    if (flash) glow = 0.9;
    else if (f.action === ACT.ATTACK && f.charge > 0) glow = 0.3 + 0.25 * Math.sin(now * 0.03);
    else if (f.action === ACT.SHIELDBREAK) glow = 0.4 + 0.3 * Math.sin(now * 0.025);
    v.mat.emissiveIntensity = glow;
    v.mat.opacity = intangible(f) && f.action !== ACT.RESPAWN ? 0.45 + 0.15 * Math.sin(now * 0.04) : 1;

    const shielding = f.action === ACT.SHIELD || f.action === ACT.SHIELDSTUN;
    v.shield.visible = shielding;
    if (shielding) {
      const s = 0.45 + 0.55 * (f.shield / SHIELD_MAX);
      v.shield.scale.setScalar(s * v.H * 0.62);
      v.shield.material.opacity = 0.22 + 0.25 * (1 - f.shield / SHIELD_MAX);
    }
    v.halo.visible = f.action === ACT.RESPAWN;
    v.marker.position.y = v.H * v.squash + 0.3 + Math.sin(now * 0.004 + f.id) * 0.03;

    v.hurt.visible = debug;
    v.hurt.scale.y = heightOf(f) / c.height;
    v.hurt.position.y = (v.H * v.hurt.scale.y) / 2;
  }

  function render(state) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    state.fighters.forEach((f, i) => drawFighter(state, f, fighters[i], dt, now));

    let n = 0;
    if (debug) {
      for (const f of state.fighters) {
        for (const h of activeHitboxes(f)) {
          const m = hitPool[n++];
          if (!m) break;
          m.visible = true;
          m.position.set(h.x * U, h.y * U, 0.9);
          m.scale.setScalar(h.r * U);
        }
      }
    }
    for (let i = n; i < hitPool.length; i++) hitPool[i].visible = false;
    blastLine.visible = debug;

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const t = e.age / e.life;
      if (t >= 1) {
        scene.remove(e.m);
        e.m.material.dispose();
        effects.splice(i, 1);
        continue;
      }
      e.m.scale.setScalar(0.15 + e.size * (1 - Math.pow(1 - t, 3)));
      e.m.material.opacity = 1 - t;
    }

    frameCamera(state, dt);
    renderer.render(scene, camera);
  }

  return {
    render,
    resize,
    setDebug(on) {
      debug = on;
    },
    get debug() {
      return debug;
    },
  };
}

