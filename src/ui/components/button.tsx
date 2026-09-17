"use client";

import type { CSSProperties, ReactNode } from "react";
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

export type ButtonVariant = "filled" | "tonal" | "outlined" | "elevated" | "text";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";
export type ButtonShape = "round" | "square";

// Button - Size token sets (m3.material.io › Buttons › Specs).
export const BUTTON_SIZES: Record<
  ButtonSize,
  { box: string; padding: number; icon: number; round: number; square: number; pressed: number; border: string }
> = {
  xs: { box: "h-8 gap-1 text-label-lg", padding: 12, icon: 20, round: 16, square: 12, pressed: 8, border: "border" },
  sm: { box: "h-10 gap-2 text-label-lg", padding: 16, icon: 20, round: 20, square: 12, pressed: 8, border: "border" },
  md: { box: "h-14 gap-2 text-title-md", padding: 24, icon: 24, round: 28, square: 16, pressed: 12, border: "border" },
  lg: { box: "h-24 gap-3 text-headline-sm", padding: 48, icon: 32, round: 48, square: 28, pressed: 16, border: "border-2" },
  xl: { box: "h-[136px] gap-4 text-headline-lg", padding: 64, icon: 40, round: 68, square: 28, pressed: 16, border: "border-3" },
};

const BASE =
  "state-layer focus-ring shape-morph touch-target relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap px-(--btn-pad) data-[disabled]:cursor-default";

const DISABLED_FILL = "data-[disabled]:bg-on-surface/10 data-[disabled]:text-on-surface/38 data-[disabled]:shadow-none";

const VARIANTS: Record<ButtonVariant, string> = {
  filled: `bg-primary text-on-primary data-[hovered]:shadow-1 ${DISABLED_FILL}`,
  tonal: `bg-secondary-container text-on-secondary-container data-[hovered]:shadow-1 ${DISABLED_FILL}`,
  outlined:
    "border-outline-variant text-on-surface-variant data-[disabled]:border-on-surface/12 data-[disabled]:text-on-surface/38",
  elevated: `bg-surface-container-low text-primary shadow-1 data-[hovered]:shadow-2 ${DISABLED_FILL}`,
  text: "text-primary data-[disabled]:text-on-surface/38",
};

export type ToggleButtonVariant = Exclude<ButtonVariant, "text">;

const TOGGLE_VARIANTS: Record<ToggleButtonVariant, string> = {
  filled: `bg-surface-container text-on-surface-variant data-[selected]:bg-primary data-[selected]:text-on-primary ${DISABLED_FILL}`,
  tonal: `bg-secondary-container text-on-secondary-container data-[selected]:bg-secondary data-[selected]:text-on-secondary ${DISABLED_FILL}`,
  outlined:
    "border-outline-variant text-on-surface-variant data-[selected]:border-inverse-surface data-[selected]:bg-inverse-surface data-[selected]:text-inverse-on-surface data-[disabled]:border-on-surface/12 data-[disabled]:text-on-surface/38",
  elevated: `bg-surface-container-low text-primary shadow-1 data-[selected]:bg-primary data-[selected]:text-on-primary ${DISABLED_FILL}`,
};

export function buttonShapeStyle(size: ButtonSize, shape: ButtonShape): CSSProperties {
  const tokens = BUTTON_SIZES[size];
  return {
    "--btn-pad": `${tokens.padding}px`,
    "--shape-rest": `${shape === "round" ? tokens.round : tokens.square}px`,
    // Toggle buttons swap between round and square when selected.
    "--shape-selected": `${shape === "round" ? tokens.square : tokens.round}px`,
    "--shape-pressed": `${tokens.pressed}px`,
  } as CSSProperties;
}

type CommonProps = {
  size?: ButtonSize;
  shape?: ButtonShape;
  icon?: IconData;
  trailingIcon?: IconData;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

function Content({
  size,
  icon,
  trailingIcon,
  isPending,
  selected,
  children,
}: Pick<CommonProps, "icon" | "trailingIcon" | "children"> & { size: ButtonSize; isPending?: boolean; selected?: boolean }) {
  const iconSize = BUTTON_SIZES[size].icon;
  return (
    <>
      {isPending ? (
        <CircularProgress size={iconSize} label="Working" />
      ) : (
        icon && <Icon icon={icon} size={iconSize} filled={selected} />
      )}
      {children != null && <span className="truncate">{children}</span>}
      {trailingIcon && <Icon icon={trailingIcon} size={iconSize} />}
    </>
  );
}

export type ButtonProps = CommonProps &
  Omit<AriaButtonProps, "className" | "style" | "children"> & { variant?: ButtonVariant };

export function Button({
  variant = "filled",
  size = "sm",
  shape = "round",
  icon,
  trailingIcon,
  className,
  style,
  children,
  ...props
}: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={cx(BASE, BUTTON_SIZES[size].box, variant === "outlined" && BUTTON_SIZES[size].border, VARIANTS[variant], className)}
      style={{ ...buttonShapeStyle(size, shape), ...style }}
    >
      {({ isPending }) => (
        <Content size={size} icon={icon} trailingIcon={trailingIcon} isPending={isPending}>
          {children}
        </Content>
      )}
    </AriaButton>
  );
}

export type LinkButtonProps = CommonProps &
  Omit<AriaLinkProps, "className" | "style" | "children"> & { variant?: ButtonVariant };

export function LinkButton({
  variant = "filled",
  size = "sm",
  shape = "round",
  icon,
  trailingIcon,
  className,
  style,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <AriaLink
      {...props}
      className={cx(BASE, BUTTON_SIZES[size].box, variant === "outlined" && BUTTON_SIZES[size].border, VARIANTS[variant], className)}
      style={{ ...buttonShapeStyle(size, shape), ...style }}
    >
      <Content size={size} icon={icon} trailingIcon={trailingIcon}>
        {children}
      </Content>
    </AriaLink>
  );
}

export type ToggleButtonProps = CommonProps &
  Omit<AriaToggleButtonProps, "className" | "style" | "children"> & { variant?: ToggleButtonVariant };

export function ToggleButton({
  variant = "filled",
  size = "sm",
  shape = "round",
  icon,
  trailingIcon,
  className,
  style,
  children,
  ...props
}: ToggleButtonProps) {
  return (
    <AriaToggleButton
      {...props}
      className={cx(BASE, BUTTON_SIZES[size].box, variant === "outlined" && BUTTON_SIZES[size].border, TOGGLE_VARIANTS[variant], className)}
      style={{ ...buttonShapeStyle(size, shape), ...style }}
    >
      {({ isSelected }) => (
        <Content size={size} icon={icon} trailingIcon={trailingIcon} selected={isSelected}>
          {children}
        </Content>
      )}
    </AriaToggleButton>
  );
}
