// Loads a fighter's Mixamo model (and its optional moves file) and poses it from the sim.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { pick, resolveClip, sampleTime, AIR_CLIPS, CLIP_WINDOWS } from './anims.js';

const loader = new GLTFLoader();
// each file loads once; every fighter instance (two in a mirror match) gets its own clone
const cache = new Map();
const load = (url) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
};
const prepared = new WeakSet(); // clips whose root motion is already stripped
const FADE = 0.09; // seconds to blend between clips

// the sim moves the fighter; clips must not carry it away. Pin the hips' sideways
// (and, for airborne clips, vertical) travel to where the clip starts.
function stripRootMotion(clip) {
  const air = AIR_CLIPS.has(clip.name);
  for (const tr of clip.tracks) {
    if (!/Hips\.position$/.test(tr.name)) continue;
    const v = tr.values;
    const [x0, y0, z0] = [v[0], v[1], v[2]];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
      if (air) v[i + 1] = y0;
    }
  }
  return clip;
}

/**
 * @param {string} url base GLB (skinned, with Idle)
 * @param {string} movesUrl optional skeleton-only GLB with one clip per move
 * @param {number} height scene units, feet to head
 * @param {string} name fighter name, for its clip timing table
 */
export async function loadFighterModel(url, movesUrl, height, name) {
  const windows = CLIP_WINDOWS[name] || {};
  const [base, moves] = await Promise.all([load(url), movesUrl ? load(movesUrl).catch(() => null) : null]);
  const model = cloneSkinned(base.scene);
  const materials = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // skinned bounds lag behind the pose
    o.material = o.material.clone();
    o.material.transparent = true;
    materials.push(o.material);
  });

  const root = new THREE.Group();
  root.add(model);

  const clips = new Map();
  for (const c of [...base.animations, ...(moves?.animations || [])]) {
    if (!prepared.has(c)) {
      stripRootMotion(c);
      prepared.add(c);
    }
    clips.set(c.name, c);
  }
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map();
  const actionFor = (name) => {
    if (!actions.has(name)) {
      const a = mixer.clipAction(clips.get(name));
      a.play();
      a.paused = true;
      a.setEffectiveWeight(0);
      actions.set(name, a);
    }
    return actions.get(name);
  };
  const has = (n) => clips.has(n);

  // normalise from the skeleton in the idle pose, not the mesh bounds (skinned bounds
  // are the bind pose, and props like a raised sword would shrink the character)
  if (clips.has('Idle')) actionFor('Idle').setEffectiveWeight(1);
  mixer.update(0);
  model.updateMatrixWorld(true);
  const bone = (re) => {
    let found = null;
    model.traverse((o) => {
      if (!found && o.isBone && re.test(o.name)) found = o;
    });
    return found;
  };
  const p = new THREE.Vector3();
  const top = bone(/HeadTop_End$/) || bone(/Head$/);
  const feet = [bone(/LeftToe_End$/) || bone(/LeftFoot$/), bone(/RightToe_End$/) || bone(/RightFoot$/)].filter(Boolean);
  const hips = bone(/Hips$/);
  if (top && feet.length && hips) {
    const yTop = top.getWorldPosition(p).y;
    const yFeet = Math.min(...feet.map((b) => b.getWorldPosition(p).y));
    const hip = hips.getWorldPosition(new THREE.Vector3());
    const k = height / (yTop - yFeet);
    model.scale.multiplyScalar(k);
    model.position.set(-hip.x * k, -yFeet * k, -hip.z * k);
  } else {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const k = height / size.y;
    model.scale.multiplyScalar(k);
    model.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
  }
  if (clips.has('Idle')) actionFor('Idle').setEffectiveWeight(0);

  let cur = null; // { name, action }
  let prev = null; // { action, w }
  let blend = 1;

  return {
    root,
    materials,
    clipNames: [...clips.keys()],
    // what is playing, for dev tooling
    debug() {
      return [...actions].map(([n, a]) => `${n}${cur?.name === n ? '*' : ''} w${a.getEffectiveWeight().toFixed(2)} t${a.time.toFixed(2)} en${+a.enabled}`);
    },
    // pose the model for this sim state; dt is wall time, used only for blending
    update(f, dt) {
      const p = pick(f);
      const name = resolveClip(p.name, has);
      if (!cur || cur.name !== name) {
        if (prev) prev.action.setEffectiveWeight(0);
        prev = cur ? { action: cur.action } : null;
        cur = { name, action: actionFor(name) };
        blend = prev ? 0 : 1;
      }
      blend = Math.min(1, blend + dt / FADE);
      cur.action.time = sampleTime(p, cur.action.getClip().duration, windows[name]);
      cur.action.setEffectiveWeight(blend);
      if (prev) {
        prev.action.setEffectiveWeight(1 - blend);
        if (blend >= 1) {
          prev.action.setEffectiveWeight(0);
          prev = null;
        }
      }
      mixer.update(0);
    },
  };
}
