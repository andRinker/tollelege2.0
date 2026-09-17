"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
  type ToggleButtonGroupProps as AriaToggleButtonGroupProps,
  type ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconCheck, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";

type GroupSize = "xs" | "sm" | "md" | "lg" | "xl";

// Standard group spacing between buttons (m3.material.io › Button groups › Specs).
const GAPS: Record<GroupSize, string> = { xs: "gap-[18px]", sm: "gap-3", md: "gap-2", lg: "gap-2", xl: "gap-2" };

type ButtonGroupProps = {
  size?: GroupSize;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

/** Buttons that react to each other: the pressed button widens and its neighbors make room. */
export function ButtonGroup({ size = "sm", children, className, ...props }: ButtonGroupProps) {
  return (
    <div role="group" {...props} className={cx("button-group flex flex-wrap items-center", GAPS[size], className)}>
      {children}
    </div>
  );
}

type ConnectedSize = "xs" | "sm" | "md";

const CONNECTED: Record<ConnectedSize, { height: string; text: string; inner: number; outer: number; icon: number }> = {
  xs: { height: "h-8 px-3", text: "text-label-lg", inner: 4, outer: 16, icon: 18 },
  sm: { height: "h-10 px-4", text: "text-label-lg", inner: 8, outer: 20, icon: 18 },
  md: { height: "h-14 px-6", text: "text-title-md", inner: 8, outer: 28, icon: 24 },
};

type ConnectedButtonGroupProps = Omit<AriaToggleButtonGroupProps, "className" | "style"> & {
  size?: ConnectedSize;
  /** Stretch to the container width with equal-width segments. */
  fullWidth?: boolean;
  className?: string;
};

/** Replaces segmented buttons: a single- or multi-select row of joined toggles. */
export function ConnectedButtonGroup({ size = "sm", fullWidth = false, className, ...props }: ConnectedButtonGroupProps) {
  const tokens = CONNECTED[size];
  return (
    <AriaToggleButtonGroup
      {...props}
      className={cx("connected-group flex gap-0.5", fullWidth ? "w-full [&>*]:flex-1" : "w-fit", className)}
      style={{ "--inner": `${tokens.inner}px`, "--outer": `${tokens.outer}px`, "--connected-size": size } as CSSProperties}
    />
  );
}

type ConnectedButtonProps = Omit<AriaToggleButtonProps, "className" | "children"> & {
  size?: ConnectedSize;
  icon?: IconData;
  children: ReactNode;
  className?: string;
};

export function ConnectedButton({ size = "sm", icon, children, className, ...props }: ConnectedButtonProps) {
  const tokens = CONNECTED[size];
  return (
    <AriaToggleButton
      {...props}
      className={cx(
        "state-layer focus-ring touch-target relative inline-flex min-w-12 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap",
        tokens.height,
        tokens.text,
        "bg-secondary-container text-on-secondary-container data-[selected]:bg-secondary data-[selected]:text-on-secondary",
        "data-[disabled]:cursor-default data-[disabled]:bg-on-surface/10 data-[disabled]:text-on-surface/38",
        className,
      )}
    >
      {({ isSelected }) => (
        <>
          {isSelected ? <Icon icon={iconCheck} size={tokens.icon} /> : icon && <Icon icon={icon} size={tokens.icon} />}
          <span className="truncate">{children}</span>
        </>
      )}
    </AriaToggleButton>
  );
}
