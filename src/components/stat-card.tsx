"use client";

import type { ReactNode } from "react";
import { Link } from "react-aria-components";
import { cx } from "@/ui/cx";
import { Shape } from "@/ui/components/expressive";
import type { ShapeName } from "@/ui/shapes/shapes";

export type StatTone = "primary" | "secondary" | "tertiary" | "error";

const TONES: Record<StatTone, [container: string, shape: string]> = {
  primary: ["bg-primary-container text-on-primary-container", "fill-primary/10"],
  secondary: ["bg-secondary-container text-on-secondary-container", "fill-secondary/10"],
  tertiary: ["bg-tertiary-container text-on-tertiary-container", "fill-tertiary/10"],
  error: ["bg-error-container text-on-error-container", "fill-error/10"],
};

type StatCardProps = {
  value: number;
  label: string;
  /** A smaller line under the label, e.g. "42 copies". */
  detail?: ReactNode;
  shape: ShapeName;
  tone: StatTone;
  href?: string;
};

/** A big tonal number with a decorative M3E shape tucked in the corner. */
export function StatCard({ value, label, detail, shape, tone, href }: StatCardProps) {
  const [container, shapeFill] = TONES[tone];
  const body = (
    <>
      <span aria-hidden="true" className="absolute -top-5 -right-5 transition-transform duration-500 ease-default-spatial group-data-[hovered]/stat:rotate-45">
        <Shape shape={shape} size={96} className={shapeFill} />
      </span>
      <span className="relative text-display-sm-em tabular-nums" style={{ fontVariationSettings: '"ROND" 100' }}>
        {value}
      </span>
      <span className="relative text-title-sm">{label}</span>
      {detail && <span className="relative text-body-sm opacity-80">{detail}</span>}
    </>
  );
  const classes = cx("group/stat relative flex flex-col gap-1 overflow-hidden rounded-xl p-5", container);
  return href ? (
    <Link href={href} className={cx(classes, "state-layer focus-ring cursor-pointer transition-shadow data-[hovered]:shadow-1")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
