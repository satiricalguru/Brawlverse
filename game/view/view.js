// Draws the sim state with Three.js. It only reads the state: everything here (camera,
// shake, flashes, squash) is presentation and can use floats and randomness freely.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ACT, FIGHTERS, STAGES, SUB, SHIELD_MAX, activeHitboxes, heightOf, intangible, MOVE_IDS } from '../sim/sim.js';
import { loadFighterModel } from './model.js';
import { buildStage } from './stages.js';

// rigged models per fighter, and their moves file (null until that fighter's clips exist: Idle only)
const MODELS = {
  Kael: ['/models/mixamo/kael.glb', '/models/mixamo/kael_moves.glb'],
  Nyx: ['/models/mixamo/nyx.glb', null],
  Bramm: ['/models/mixamo/bramm.glb', null],
  Zephra: ['/models/mixamo/zephra.glb', null],
};
const HEAVY = new Set(['fsmash', 'usmash', 'dsmash', 'fair', 'bair', 'dair']);

const U = 1 / (SUB * 100); // sub-pixels -> scene units (100 px = 1 unit)

export function createView(canvas, { audio = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0912');
  scene.fog = new THREE.Fog('#0b0912', 18, 46);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(0, 2.2, 18);

  /* ---------- light (each stage sets its own mood) ---------- */
  const hemi = new THREE.HemisphereLight('#9fb2ff', '#1a1020', 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff1e0', 2.4);
  key.position.set(4, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 1024);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 6, bottom: -3, near: 1, far: 30 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  // rim lights in each player's colour, behind them
  const rims = [new THREE.PointLight('#ffffff', 18, 30, 2), new THREE.PointLight('#ffffff', 18, 30, 2)];
  rims[0].position.set(-9, 4, -3);
  rims[1].position.set(9, 4, -3);
  scene.add(...rims);
  // soft fill from the camera side so dark armour still reads
  const fill = new THREE.DirectionalLight('#cfd8ff', 0.9);
  fill.position.set(-2, 3, 12);
  scene.add(fill);

  /* ---------- stage ---------- */
  let stageId = -1;
  let stageV = null;
  let blastLine = null;
  function setStage(id) {
    if (stageV) {
      scene.remove(stageV.group);
      stageV.dispose();
    }
    if (blastLine) scene.remove(blastLine);
    stageId = id;
    stageV = buildStage(id);
    scene.add(stageV.group);
    const m = stageV.mood;
    // the backdrop fades into the haze at its lower edge, so the sky behind matches the haze
    scene.background = new THREE.Color(m.fog[0]);
    scene.fog = new THREE.Fog(m.fog[0], m.fog[1], m.fog[2]);
    hemi.color.set(m.hemi[0]);
    hemi.groundColor.set(m.hemi[1]);
    hemi.intensity = m.hemi[2];
    key.color.set(m.key[0]);
    key.intensity = m.key[1];
    renderer.toneMappingExposure = m.exposure;
    // blast zone outline (debug view only)
    const b = STAGES[id].blast;
    blastLine = new THREE.LineLoop(
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
    if (blastLine) blastLine.visible = debug;
    scene.add(blastLine);
  }

  /* ---------- fighters (rebuilt when a player picks someone else) ---------- */
  const fighters = [null, null];
  function makeFighter(char, i, mirror) {
    const c = FIGHTERS[char];
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
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, R * 1.3), new THREE.MeshBasicMaterial({ color: '#fff7ea' }));
    visor.position.set(R * 0.85, H - R * 1.05, 0);
    body.add(visor);
    // player marker above the head (white for the second player in a mirror match)
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.16, 3),
      new THREE.MeshBasicMaterial({ color: mirror ? '#ffffff' : color, toneMapped: false })
    );
    marker.rotation.z = Math.PI;
    marker.position.y = H + 0.32;
    root.add(marker);
    // shield bubble
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    shield.position.y = H * 0.5;
    root.add(shield);
    // respawn halo
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
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
    // the rigged model hangs here once it has loaded; until then the capsule stands in
    const rig = new THREE.Group();
    root.add(rig);
    scene.add(root);
    rims[i].color.set(c.color);
    const v = { char, root, body, rig, mat, capsule, visor, marker, shield, halo, hurt, color, H, model: null, gone: false };
    Object.assign(v, { seenHit: -1, seenKo: -1, squash: 1, prevAction: -1, prevMove: -1, prevJumps: c.jumps, prevGrounded: true, lastAf: 0 });
    const urls = MODELS[c.name];
    if (urls) {
      loadFighterModel(urls[0], urls[1], H * 1.08, c.name)
        .then((m) => {
          if (v.gone) return; // replaced while loading
          v.model = m;
          rig.add(m.root);
          capsule.visible = visor.visible = false;
        })
        .catch((err) => console.warn(`${c.name}: model failed to load, keeping the capsule`, err));
    }
    return v;
  }
  function syncFighters(state) {
    state.fighters.forEach((f, i) => {
      const mirror = i === 1 && state.fighters[0]?.char === f.char;
      if (fighters[i] && fighters[i].char === f.char && fighters[i].mirror === mirror) return;
      if (fighters[i]) {
        fighters[i].gone = true;
        scene.remove(fighters[i].root);
      }
      fighters[i] = makeFighter(f.char, i, mirror);
      fighters[i].mirror = mirror;
    });
  }

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

  const panOf = (f) => Math.max(-1, Math.min(1, f.x / (STAGES[stageId].blast.right * 0.6)));

  // sounds for things that just started: swings, jumps, landings, shield breaks
  function cues(f, v) {
    if (!audio) return;
    const pan = panOf(f);
    const newAttack = f.action === ACT.ATTACK && (v.prevAction !== ACT.ATTACK || v.prevMove !== f.move || f.af < v.lastAf);
    if (newAttack) audio.swing(HEAVY.has(MOVE_IDS[f.move]), pan);
    const jumped = !f.grounded && f.vy > 0 && (f.jumpsLeft < v.prevJumps || (v.prevGrounded && f.action === ACT.AIR));
    if (jumped) audio.jump(pan);
    else if (!v.prevGrounded && f.grounded && f.action === ACT.LAND) audio.land(pan);
    if (f.action === ACT.SHIELDBREAK && v.prevAction !== ACT.SHIELDBREAK) audio.shieldBreak(pan);
    v.prevAction = f.action;
    v.prevMove = f.move;
    v.prevJumps = f.jumpsLeft;
    v.prevGrounded = f.grounded;
    v.lastAf = f.af;
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
      audio?.ko(panOf(f));
    }
    if (dead) return;

    // a new hit: spark, flash, shake scaled by knockback
    if (f.hitFrame !== v.seenHit && f.hitFrame >= 0) {
      v.seenHit = f.hitFrame;
      const hx = f.x * U;
      const hy = f.y * U + v.H * 0.55;
      burst(hx, hy, f.blocked ? v.color : '#fff1c9', f.blocked ? 0.7 : 0.6 + f.lastKb / 160, 0.32);
      shake = Math.max(shake, Math.min(0.5, f.lastKb / 300));
      if (f.blocked) audio?.block(panOf(f));
      else audio?.hit(f.lastKb, panOf(f));
    }
    cues(f, v);

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
    const opacity = intangible(f) && f.action !== ACT.RESPAWN ? 0.45 + 0.15 * Math.sin(now * 0.04) : 1;
    v.mat.opacity = opacity;

    if (v.model) {
      v.model.update(f, dt);
      // side-on to the fight, turned a little toward the camera so faces read
      v.rig.rotation.y = f.facing > 0 ? Math.PI / 2 - 0.45 : -Math.PI / 2 + 0.45;
      v.rig.rotation.z = v.body.rotation.z * 0.6;
      // the clips crouch on their own; squash only for the jump-squat and landing
      const ry = f.action === ACT.CROUCH ? 1 : v.squash;
      v.rig.scale.set(1 / Math.sqrt(ry), ry, 1 / Math.sqrt(ry));
      for (const m of v.model.materials) {
        m.emissive.set(flash ? '#ffffff' : v.color);
        m.emissiveIntensity = flash ? 0.85 : Math.max(0, glow - 0.12);
        m.opacity = opacity;
      }
    }

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

    if (state.stage !== stageId) setStage(state.stage);
    syncFighters(state);
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
    if (blastLine) blastLine.visible = debug;

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
    stageV.update(now / 1000, camera);
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
    // loaded rigged models, for dev tooling
    get models() {
      return fighters.map((v) => v?.model ?? null);
    },
  };
}

