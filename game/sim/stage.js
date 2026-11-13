import { px } from './fixed.js';

// The grey-box test stage: one solid main block with grabbable ledges at both top
// corners, three pass-through platforms, and blast zones. World units are pixels,
// x to the right, y up, the main floor's top at y = 0.

export const PROVING_GROUNDS = {
  name: 'Proving Grounds',
  // solid: you stand on top, cannot pass through the sides or from below
  main: { left: px(-560), right: px(560), top: 0, bottom: px(-140) },
  // pass-through: land on them from above, drop through with down
  platforms: [
    { left: px(-400), right: px(-170), top: px(150) },
    { left: px(170), right: px(400), top: px(150) },
    { left: px(-115), right: px(115), top: px(290) },
  ],
  // side: which way the stage edge faces (-1 = left edge, +1 = right edge)
  ledges: [
    { x: px(-560), y: 0, side: -1 },
    { x: px(560), y: 0, side: 1 },
  ],
  blast: { left: px(-1250), right: px(1250), top: px(1100), bottom: px(-700) },
  spawns: [
    { x: px(-260), y: 0, facing: 1 },
    { x: px(260), y: 0, facing: -1 },
  ],
  respawn: [
    { x: px(-140), y: px(460) },
    { x: px(140), y: px(460) },
  ],
};
