import { px } from './fixed.js';

// Stage layouts. World units are pixels, x to the right, y up, the main floor's top at
// y = 0. `main` is solid (stand on it, cannot pass through its sides or from below);
// `platforms` are pass-through (land from above, drop through with down); ledges sit
// at the main floor's top corners; `side` says which way that edge faces. `grip` scales
// ground friction (percent). Ids are positions in STAGES and are what the netcode sends.

const edges = (left, right) => [
  { x: px(left), y: 0, side: -1 },
  { x: px(right), y: 0, side: 1 },
];
const plat = (l, r, top) => ({ left: px(l), right: px(r), top: px(top) });
const pt = (x, y, facing) => ({ x: px(x), y: px(y), facing });

function stage({ name, half, depth, platforms, blast, grip = 100, spawn = 260 }) {
  return {
    name,
    main: { left: px(-half), right: px(half), top: 0, bottom: px(-depth) },
    platforms: platforms.map((p) => plat(...p)),
    ledges: edges(-half, half),
    blast: { left: px(-blast[0]), right: px(blast[0]), top: px(blast[1]), bottom: px(-blast[2]) },
    grip,
    spawns: [pt(-spawn, 0, 1), pt(spawn, 0, -1)],
    respawn: [pt(-140, 460), pt(140, 460)],
  };
}

// the grey-box test stage
export const PROVING_GROUNDS = stage({
  name: 'Proving Grounds',
  half: 560,
  depth: 140,
  platforms: [
    [-400, -170, 150],
    [170, 400, 150],
    [-115, 115, 290],
  ],
  blast: [1250, 1100, 700],
});

// a foundry slab hung on chains over lava: wide floor, two hanging grates
export const CINDER_FORGE = stage({
  name: 'Cinder Forge',
  half: 600,
  depth: 170,
  platforms: [
    [-340, -130, 175],
    [130, 340, 175],
  ],
  blast: [1300, 1150, 720],
  spawn: 280,
});

// a helipad between towers: a tighter floor and one high drone pad
export const NEON_ABYSS = stage({
  name: 'Neon Abyss',
  half: 520,
  depth: 120,
  platforms: [[-150, 150, 235]],
  blast: [1240, 1120, 700],
  spawn: 240,
});

// a drowned arena: the widest floor, two broken pillar tops and a high arch stone
export const SUNKEN_COLOSSEUM = stage({
  name: 'Sunken Colosseum',
  half: 690,
  depth: 150,
  platforms: [
    [-470, -270, 150],
    [270, 470, 150],
    [-100, 100, 300],
  ],
  blast: [1420, 1180, 720],
  spawn: 320,
});

// an ice bridge under the aurora: slippery footing, one high ledge of ice
export const FROSTSPIRE_SUMMIT = stage({
  name: 'Frostspire Summit',
  half: 570,
  depth: 100,
  platforms: [[-160, 160, 255]],
  blast: [1260, 1150, 700],
  grip: 45,
  spawn: 260,
});

export const STAGE_LIST = [PROVING_GROUNDS, CINDER_FORGE, NEON_ABYSS, SUNKEN_COLOSSEUM, FROSTSPIRE_SUMMIT];
