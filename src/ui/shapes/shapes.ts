/**
 * Material 3 Expressive-style shapes. Each is defined as a signed distance function
 * (rounded polygons, rounded stars, capsules, smooth circle unions) and sampled as
 * radii at fixed angles, so any two shapes can morph by interpolating radii.
 */

const SAMPLES = 120;
const TAU = Math.PI * 2;

type Sdf = (x: number, y: number) => number;

const mod = (value: number, n: number) => ((value % n) + n) % n;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rotate(sdf: Sdf, angle: number): Sdf {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return (x, y) => sdf(x * cos - y * sin, x * sin + y * cos);
}

/** Regular polygon with circumradius 1 and rounded corners (Inigo Quilez, exact SDF). */
function roundedPolygon(sides: number, rounding: number): Sdf {
  const r = 1 - rounding;
  const an = Math.PI / sides;
  const acx = Math.cos(an);
  const acy = Math.sin(an);
  return (x, y) => {
    const length = Math.hypot(x, y);
    const bn = mod(Math.atan2(x, y), 2 * an) - an;
    const px = length * Math.cos(bn) - r * acx;
    let py = length * Math.abs(Math.sin(bn)) - r * acy;
    py += clamp(-py, 0, r * acy);
    return Math.hypot(px, py) * Math.sign(px) - rounding;
  };
}

function capsule(halfLength: number, radius: number): Sdf {
  return (x, y) => Math.hypot(x - clamp(x, -halfLength, halfLength), y) - radius;
}

function ellipse(a: number, b: number): Sdf {
  return (x, y) => (Math.hypot(x / a, y / b) - 1) * Math.min(a, b);
}

/**
 * A wavy outline in polar form: radius dips by `depth` between `lobes` bumps.
 * `sharpness` below 1 narrows the tips (sunny, burst); above 1 widens the bumps
 * and narrows the valleys (cookies, clovers).
 */
function wavy(lobes: number, depth: number, sharpness: number, offset = 0): Sdf {
  return (x, y) => {
    const theta = Math.atan2(y, x) - offset;
    const valley = (1 - Math.cos(lobes * theta)) / 2;
    return Math.hypot(x, y) - (1 - depth * valley ** sharpness);
  };
}

const DEFINITIONS = {
  circle: (x: number, y: number) => Math.hypot(x, y) - 1,
  oval: rotate(ellipse(1, 0.66), -Math.PI / 4),
  pill: rotate(capsule(0.45, 0.55), -Math.PI / 4),
  square: rotate(roundedPolygon(4, 0.3), Math.PI / 4),
  pentagon: rotate(roundedPolygon(5, 0.2), Math.PI),
  gem: roundedPolygon(6, 0.24),
  cookie4: wavy(4, 0.2, 1.6, Math.PI / 4),
  cookie6: wavy(6, 0.2, 1.4),
  cookie7: wavy(7, 0.2, 1.3),
  cookie9: wavy(9, 0.17, 1.2),
  cookie12: wavy(12, 0.14, 1.1),
  sunny: wavy(8, 0.17, 0.75),
  verySunny: wavy(8, 0.32, 0.7),
  softBurst: wavy(10, 0.26, 0.6),
  burst: wavy(12, 0.3, 0.45),
  clover4: wavy(4, 0.46, 2.4, Math.PI / 4),
  clover8: wavy(8, 0.3, 2.2),
  flower: wavy(6, 0.36, 1.9),
} satisfies Record<string, Sdf>;

export type ShapeName = keyof typeof DEFINITIONS;

export const SHAPE_NAMES = Object.keys(DEFINITIONS) as ShapeName[];

const radiiCache = new Map<ShapeName, readonly number[]>();

/** Radii (0–1) at SAMPLES evenly spaced angles, normalized so the widest point is 1. */
export function getShapeRadii(name: ShapeName): readonly number[] {
  const cached = radiiCache.get(name);
  if (cached) return cached;

  const sdf: Sdf = DEFINITIONS[name];
  const radii: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const theta = (i / SAMPLES) * TAU;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    let inside = 0;
    let outside = 2;
    for (let k = 0; k < 24; k++) {
      const mid = (inside + outside) / 2;
      if (sdf(dx * mid, dy * mid) <= 0) inside = mid;
      else outside = mid;
    }
    radii.push(inside);
  }
  const max = Math.max(...radii);
  const normalized = radii.map((r) => r / max);
  radiiCache.set(name, normalized);
  return normalized;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** A smooth closed SVG path (Catmull-Rom through the samples) filling a size×size box. */
export function radiiToPath(radii: readonly number[], size: number, rotationDegrees = 0): string {
  const count = radii.length;
  const center = size / 2;
  const rotation = (rotationDegrees * Math.PI) / 180;
  const points = radii.map((r, i) => {
    const theta = (i / count) * TAU + rotation;
    return [center + Math.cos(theta) * r * center, center + Math.sin(theta) * r * center] as const;
  });

  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 0; i < count; i++) {
    const p0 = points[(i - 1 + count) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    d +=
      `C${fmt(p1[0] + (p2[0] - p0[0]) / 6)} ${fmt(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${fmt(p2[0] - (p3[0] - p1[0]) / 6)} ${fmt(p2[1] - (p3[1] - p1[1]) / 6)} ` +
      `${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return `${d}Z`;
}

export function shapePath(name: ShapeName, size: number, rotationDegrees = 0): string {
  return radiiToPath(getShapeRadii(name), size, rotationDegrees);
}

/** Interpolates two shapes. `t` may overshoot 1 for spring motion. */
export function morphRadii(from: readonly number[], to: readonly number[], t: number): number[] {
  return from.map((r, i) => Math.max(0.02, r + (to[i] - r) * t));
}
