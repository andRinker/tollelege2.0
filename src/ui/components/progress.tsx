"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ProgressBar } from "react-aria-components";
import { cx } from "@/ui/cx";

const TRACK = 4;
const AMPLITUDE = 3;
const WAVELENGTH = 40;
const INDETERMINATE_WAVELENGTH = 20;
const GAP = 4;
const HEIGHT = 10;

function wavePath(length: number, wavelength: number): string {
  const mid = HEIGHT / 2;
  const half = wavelength / 2;
  // Start one wavelength early so the phase animation never shows the path's end.
  let d = `M${-wavelength} ${mid}`;
  for (let x = -wavelength; x < length + wavelength; x += half) {
    const direction = Math.round(x / half) % 2 === 0 ? -1 : 1;
    d += `Q${x + half / 2} ${mid + direction * AMPLITUDE * 2} ${x + half} ${mid}`;
  }
  return d;
}

function useWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type LinearProgressProps = {
  /** 0–1. Omit for an indeterminate indicator. */
  value?: number;
  label: string;
  /** Wavy active indicator (M3 Expressive). */
  wavy?: boolean;
  className?: string;
};

export function LinearProgress({ value, label, wavy = true, className }: LinearProgressProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const indeterminate = value === undefined;
  const fraction = indeterminate ? 0.4 : Math.min(1, Math.max(0, value));
  const activeWidth = width * fraction;
  const wavelength = indeterminate ? INDETERMINATE_WAVELENGTH : WAVELENGTH;
  const mid = HEIGHT / 2;
  const clipId = `progress-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <ProgressBar
      aria-label={label}
      value={indeterminate ? undefined : fraction * 100}
      isIndeterminate={indeterminate}
      className={cx("w-full", className)}
    >
      <div ref={ref} className="relative w-full overflow-hidden" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} className="absolute inset-0" aria-hidden="true">
            {indeterminate ? (
              <line x1={0} x2={width} y1={mid} y2={mid} strokeWidth={TRACK} strokeLinecap="round" className="stroke-secondary-container" />
            ) : (
              <>
                {activeWidth + GAP + TRACK < width && (
                  <line
                    x1={activeWidth + GAP + TRACK / 2}
                    x2={width - TRACK / 2}
                    y1={mid}
                    y2={mid}
                    strokeWidth={TRACK}
                    strokeLinecap="round"
                    className="stroke-secondary-container"
                  />
                )}
                <circle cx={width - TRACK / 2} cy={mid} r={TRACK / 2} className="fill-primary" />
              </>
            )}
            <g className={indeterminate ? "animate-[progress-slide_1.8s_var(--ease-default-effects)_infinite]" : undefined}>
              <clipPath id={clipId}>
                <rect x={0} y={0} width={Math.max(activeWidth, 0)} height={HEIGHT} rx={TRACK / 2} />
              </clipPath>
              <g clipPath={`url(#${clipId})`}>
                {wavy ? (
                  <path
                    d={wavePath(Math.max(activeWidth, 0), wavelength)}
                    fill="none"
                    strokeWidth={TRACK}
                    strokeLinecap="round"
                    className="stroke-primary animate-[wave-phase_1s_linear_infinite]"
                    style={{ ["--wave" as string]: `${wavelength}px` }}
                  />
                ) : (
                  <line x1={TRACK / 2} x2={activeWidth - TRACK / 2} y1={mid} y2={mid} strokeWidth={TRACK} strokeLinecap="round" className="stroke-primary" />
                )}
              </g>
            </g>
          </svg>
        )}
      </div>
    </ProgressBar>
  );
}

type CircularProgressProps = {
  size?: number;
  label?: string;
  className?: string;
};

/** Indeterminate circular indicator for inline waits, such as a pending button. */
export function CircularProgress({ size = 24, label = "Loading", className }: CircularProgressProps) {
  const stroke = Math.max(2, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  return (
    <ProgressBar aria-label={label} isIndeterminate className={cx("inline-block shrink-0", className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="animate-[spin_1.4s_linear_infinite]"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          className="animate-[arc-dash_1.4s_var(--ease-default-effects)_infinite]"
        />
      </svg>
    </ProgressBar>
  );
}
