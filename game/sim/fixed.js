// Integer maths for the simulation. Every value the sim stores is an integer, so two
// browsers fed the same inputs reach the same state bit for bit (floats can differ in
// the last digit between engines, and rollback netcode cannot survive that).
//
// Positions and speeds are in sub-pixels: 1 world pixel = SUB sub-pixels.

export const SUB = 256;

// px(7.5) -> 1920. Only used on constants when data is defined, never inside the step.
export const px = (v) => Math.round(v * SUB);

// integer division that rounds toward zero, the same in every engine
export const idiv = (a, b) => Math.trunc(a / b);

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// move v toward 0 by step without crossing it
export const toward0 = (v, step) => (v > 0 ? Math.max(0, v - step) : Math.min(0, v + step));

// move v toward target by step without overshooting
export const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

// sin(0..90°) × 4096, as literal integers so no engine's Math.sin is ever involved
const SIN_Q = [
  0, 71, 143, 214, 286, 357, 428, 499, 570, 641, 711, 782, 852, 921, 991, 1060, 1129, 1198, 1266, 1334, 1401, 1468, 1534,
  1600, 1666, 1731, 1796, 1860, 1923, 1986, 2048, 2110, 2171, 2231, 2290, 2349, 2408, 2465, 2522, 2578, 2633, 2687, 2741,
  2793, 2845, 2896, 2946, 2996, 3044, 3091, 3138, 3183, 3228, 3271, 3314, 3355, 3396, 3435, 3474, 3511, 3547, 3582, 3617,
  3650, 3681, 3712, 3742, 3770, 3798, 3824, 3849, 3873, 3896, 3917, 3937, 3956, 3974, 3991, 4006, 4021, 4034, 4046, 4056,
  4065, 4074, 4080, 4086, 4090, 4094, 4095, 4096,
];
export const ONE = 4096;

// sine and cosine of a whole-degree angle, scaled by ONE
export function isin(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d <= 90) return SIN_Q[d];
  if (d <= 180) return SIN_Q[180 - d];
  if (d <= 270) return -SIN_Q[d - 180];
  return -SIN_Q[360 - d];
}
export const icos = (deg) => isin(deg + 90);
