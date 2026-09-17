"use client";

import type { CSSProperties } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  ToggleButton as AriaToggleButton,
  type ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import type { IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";
import { CircularProgress } from "./progress";
import { Tooltip, TooltipTrigger } from "./tooltip";

export type IconButtonVariant = "standard" | "filled" | "tonal" | "outlined";
export type IconButtonSize = "xs" | "sm" | "md" | "lg" | "xl";
export type IconButtonWidth = "narrow" | "default" | "wide";

// Icon button - Size token sets (m3.material.io › Icon buttons › Specs).
const SIZES: Record<
  IconButtonSize,
  { height: string; widths: Record<IconButtonWidth, number>; icon: number; round: number; square: number; pressed: number; border: string }
> = {
  xs: { height: "h-8", widths: { narrow: 28, default: 32, wide: 40 }, icon: 20, round: 16, square: 12, pressed: 8, border: "border" },
  sm: { height: "h-10", widths: { narrow: 32, default: 40, wide: 52 }, icon: 24, round: 20, square: 12, pressed: 8, border: "border" },
  md: { height: "h-14", widths: { narrow: 48, default: 56, wide: 72 }, icon: 24, round: 28, square: 16, pressed: 12, border: "border" },
  lg: { height: "h-24", widths: { narrow: 64, default: 96, wide: 128 }, icon: 32, round: 48, square: 28, pressed: 16, border: "border-2" },
  xl: { height: "h-[136px]", widths: { narrow: 104, default: 136, wide: 184 }, icon: 40, round: 68, square: 28, pressed: 16, border: "border-3" },
};

const BASE =
  "state-layer focus-ring shape-morph touch-target relative inline-grid w-(--btn-w) shrink-0 cursor-pointer select-none place-items-center data-[disabled]:cursor-default";

const VARIANTS: Record<IconButtonVariant, string> = {
  standard: "text-on-surface-variant data-[disabled]:text-on-surface/38",
  filled: "bg-primary text-on-primary data-[disabled]:bg-on-surface/10 data-[disabled]:text-on-surface/38",
  tonal: "bg-secondary-container text-on-secondary-container data-[disabled]:bg-on-surface/10 data-[disabled]:text-on-surface/38",
  outlined: "border-outline-variant text-on-surface-variant data-[disabled]:border-on-surface/12 data-[disabled]:text-on-surface/38",
};

const TOGGLE_VARIANTS: Record<IconButtonVariant, string> = {
  standard: "text-on-surface-variant data-[selected]:text-primary data-[disabled]:text-on-surface/38",
  filled:
    "bg-surface-container text-on-surface-variant data-[selected]:bg-primary data-[selected]:text-on-primary data-[disabled]:bg-on-surface/10 data-[disabled]:text-on-surface/38",
  tonal:
    "bg-secondary-container text-on-secondary-container data-[selected]:bg-secondary data-[selected]:text-on-secondary data-[disabled]:bg-on-surface/10 data-[disabled]:text-on-surface/38",
  outlined:
    "border-outline-variant text-on-surface-variant data-[selected]:border-inverse-surface data-[selected]:bg-inverse-surface data-[selected]:text-inverse-on-surface data-[disabled]:border-on-surface/12 data-[disabled]:text-on-surface/38",
};

const COMPACT =
  "max-medium:h-10 max-medium:[--btn-w:40px]! max-medium:[--shape-rest:20px]! max-medium:[--shape-selected:12px]! max-medium:[--shape-pressed:8px]!";

type CommonProps = {
  icon: IconData;
  /** Use the small size on phones. */
  compact?: boolean;
  /** Accessible name. Also shown as a tooltip unless `tooltip` is false. */
  label: string;
  tooltip?: boolean;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  width?: IconButtonWidth;
  shape?: "round" | "square";
  className?: string;
};

function classes({ variant = "standard", size = "sm", compact = false }: CommonProps, toggle: boolean) {
  const tokens = SIZES[size];
  return cx(
    BASE,
    tokens.height,
    compact && COMPACT,
    variant === "outlined" && tokens.border,
    (toggle ? TOGGLE_VARIANTS : VARIANTS)[variant],
  );
}

function shapeStyle({ size = "sm", shape = "round", width = "default" }: CommonProps): CSSProperties {
  const tokens = SIZES[size];
  return {
    "--btn-w": `${tokens.widths[width]}px`,
    "--shape-rest": `${shape === "round" ? tokens.round : tokens.square}px`,
    "--shape-selected": `${shape === "round" ? tokens.square : tokens.round}px`,
    "--shape-pressed": `${tokens.pressed}px`,
  } as CSSProperties;
}

function withTooltip(label: string, enabled: boolean | undefined, element: React.ReactElement) {
  if (enabled === false) return element;
  return (
    <TooltipTrigger delay={600}>
      {element}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

export type IconButtonProps = CommonProps & Omit<AriaButtonProps, "className" | "style" | "children">;

export function IconButton({ icon, label, tooltip, variant, size = "sm", width, shape, compact, className, ...rest }: IconButtonProps) {
  const tokens = { icon, label, variant, size, width, shape, compact };
  return withTooltip(
    label,
    tooltip,
    <AriaButton
      {...rest}
      aria-label={label}
      className={cx(classes(tokens, false), className)}
      style={shapeStyle(tokens)}
    >
      {({ isPending }) =>
        isPending ? <CircularProgress size={SIZES[size].icon} label="Working" /> : <Icon icon={icon} size={SIZES[size].icon} />
      }
    </AriaButton>,
  );
}

export type LinkIconButtonProps = CommonProps & Omit<AriaLinkProps, "className" | "style" | "children">;

export function LinkIconButton({ icon, label, tooltip, variant, size = "sm", width, shape, compact, className, ...rest }: LinkIconButtonProps) {
  const tokens = { icon, label, variant, size, width, shape, compact };
  return withTooltip(
    label,
    tooltip,
    <AriaLink {...rest} aria-label={label} className={cx(classes(tokens, false), className)} style={shapeStyle(tokens)}>
      <Icon icon={icon} size={SIZES[size].icon} />
    </AriaLink>,
  );
}

export type ToggleIconButtonProps = CommonProps & Omit<AriaToggleButtonProps, "className" | "style" | "children">;

export function ToggleIconButton({ icon, label, tooltip, variant, size = "sm", width, shape, compact, className, ...rest }: ToggleIconButtonProps) {
  const tokens = { icon, label, variant, size, width, shape, compact };
  return withTooltip(
    label,
    tooltip,
    <AriaToggleButton {...rest} aria-label={label} className={cx(classes(tokens, true), className)} style={shapeStyle(tokens)}>
      {({ isSelected }) => <Icon icon={icon} size={SIZES[size].icon} filled={isSelected} />}
    </AriaToggleButton>,
  );
}
