"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/ui/cx";
import { getShapeRadii, morphRadii, radiiToPath, type ShapeName } from "@/ui/shapes/shapes";

// Shape order from the M3 Expressive loading indicator.
const SEQUENCE: ShapeName[] = ["softBurst", "cookie9", "pentagon", "pill", "sunny", "cookie4", "oval"];
const MORPH_MS = 650;
const BOX = 48;
const SHAPE = 38;

/** Position of an underdamped spring (damping ratio 0.6, stiffness 800) released from 0 toward 1. */
function springProgress(ms: number): number {
  const zeta = 0.6;
  const omega = Math.sqrt(800);
  const t = ms / 1000;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

type LoadingIndicatorProps = {
  size?: number;
  /** Adds a circular primary-container background. */
  contained?: boolean;
  label?: string;
  /** Shows a still shape, e.g. for screenshots. Reduced-motion users always get this. */
  paused?: boolean;
  className?: string;
};

export function LoadingIndicator({ size = BOX, contained = false, label = "Loading", paused = false, className }: LoadingIndicatorProps) {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    if (!path || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const shapes = SEQUENCE.map(getShapeRadii);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - start;
      const step = Math.floor(elapsed / MORPH_MS);
      const progress = springProgress(elapsed - step * MORPH_MS);
      const radii = morphRadii(shapes[step % shapes.length], shapes[(step + 1) % shapes.length], progress);
      const rotation = (step + progress) * 90 + elapsed * 0.077;
      path.setAttribute("d", radiiToPath(radii, SHAPE, rotation));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [paused]);

  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cx("inline-grid shrink-0 place-items-center", contained && "rounded-full bg-primary-container", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${BOX} ${BOX}`} width={size} height={size} aria-hidden="true">
        <path
          ref={pathRef}
          transform={`translate(${(BOX - SHAPE) / 2} ${(BOX - SHAPE) / 2})`}
          className={contained ? "fill-on-primary-container" : "fill-primary"}
          d={radiiToPath(getShapeRadii(SEQUENCE[0]), SHAPE)}
        />
      </svg>
    </div>
  );
}
