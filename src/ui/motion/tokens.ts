import type { Transition } from "motion/react";

/**
 * Converts a Material spring token (damping ratio + stiffness) into a `motion`
 * spring, whose damping is an absolute coefficient: c = 2ζ√(k·m) with m = 1.
 */
function spring(dampingRatio: number, stiffness: number): Transition {
  return { type: "spring", stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness), mass: 1 };
}

/** M3 Expressive motion scheme (m3.material.io › Motion › Specs). */
export const springs = {
  fastSpatial: spring(0.6, 800),
  defaultSpatial: spring(0.8, 380),
  slowSpatial: spring(0.8, 200),
  fastEffects: spring(1, 3800),
  defaultEffects: spring(1, 1600),
  slowEffects: spring(1, 800),
  /** Components morph their shape with the standard fast spatial spring. */
  shapeMorph: spring(0.9, 1400),
} as const;
