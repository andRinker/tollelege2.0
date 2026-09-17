"use client";

import { Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";
import { cx } from "@/ui/cx";

export function TextLink({ className, ...props }: Omit<AriaLinkProps, "className"> & { className?: string }) {
  return (
    <AriaLink
      {...props}
      className={cx(
        "focus-ring cursor-pointer rounded-xs text-primary underline decoration-primary/40 underline-offset-4 transition-colors data-[hovered]:decoration-primary",
        className,
      )}
    />
  );
}
