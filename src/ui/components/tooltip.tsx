"use client";

import {
  Tooltip as AriaTooltip,
  type TooltipProps as AriaTooltipProps,
  TooltipTrigger as AriaTooltipTrigger,
  type TooltipTriggerComponentProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";

export function TooltipTrigger(props: TooltipTriggerComponentProps) {
  return <AriaTooltipTrigger delay={600} closeDelay={150} {...props} />;
}

type TooltipProps = Omit<AriaTooltipProps, "className" | "children"> & {
  className?: string;
  children: React.ReactNode;
};

/** Plain tooltip: short label on inverse surface. */
export function Tooltip({ className, children, offset = 4, ...props }: TooltipProps) {
  return (
    <AriaTooltip
      {...props}
      offset={offset}
      className={cx(
        "max-w-xs rounded-xs bg-inverse-surface px-2 py-1 text-body-sm text-inverse-on-surface",
        "data-[entering]:animate-[tooltip-in_150ms_var(--ease-fast-effects)] data-[exiting]:animate-[tooltip-in_100ms_var(--ease-fast-effects)_reverse]",
        className,
      )}
    >
      {children}
    </AriaTooltip>
  );
}
