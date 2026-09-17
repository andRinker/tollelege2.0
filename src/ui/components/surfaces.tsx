"use client";

import type { ComponentProps, ReactNode } from "react";
import { Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";
import { cx } from "@/ui/cx";

export type CardVariant = "elevated" | "filled" | "outlined";

const CARD: Record<CardVariant, string> = {
  elevated: "bg-surface-container-low shadow-1",
  filled: "bg-surface-container-highest",
  outlined: "border border-outline-variant bg-surface",
};

export function Card({
  variant = "filled",
  className,
  ...props
}: ComponentProps<"div"> & { variant?: CardVariant }) {
  return <div {...props} className={cx("rounded-md text-on-surface", CARD[variant], className)} />;
}

/** A whole card that navigates when pressed. */
export function CardLink({
  variant = "filled",
  className,
  ...props
}: Omit<AriaLinkProps, "className"> & { variant?: CardVariant; className?: string }) {
  return (
    <AriaLink
      {...props}
      className={cx(
        "state-layer focus-ring block cursor-pointer rounded-md text-on-surface transition-shadow",
        CARD[variant],
        variant === "elevated" && "data-[hovered]:shadow-2",
        variant === "filled" && "data-[hovered]:shadow-1",
        className,
      )}
    />
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx("border-0 border-t border-outline-variant", className)} />;
}

type BadgeProps = { count?: number; max?: number; className?: string; label?: string };

/** Small dot, or a count when `count` is given. */
export function Badge({ count, max = 99, className, label }: BadgeProps) {
  if (count === undefined) {
    return <span aria-label={label} className={cx("inline-block size-1.5 rounded-full bg-error", className)} />;
  }
  return (
    <span
      aria-label={label}
      className={cx("inline-grid h-4 min-w-4 place-items-center rounded-full bg-error px-1 text-label-sm text-on-error", className)}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

type SectionHeaderProps = { title: ReactNode; action?: ReactNode; className?: string };

export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <div className={cx("flex min-h-12 items-center justify-between gap-4", className)}>
      <h2 className="text-title-lg-em text-on-surface">{title}</h2>
      {action}
    </div>
  );
}
