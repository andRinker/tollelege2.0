"use client";

import type { ReactNode } from "react";
import { Button as AriaButton, Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";
import { cx } from "@/ui/cx";

/**
 * M3 Expressive segmented list: items sit in separate rounded containers with a
 * 2px gap; the group's outer corners are large and inner corners small.
 */
export function List({ children, className, "aria-label": ariaLabel }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <ul aria-label={ariaLabel} className={cx("flex flex-col gap-0.5", className)}>
      {children}
    </ul>
  );
}

const ITEM_SHAPE =
  "rounded-xs group-first/item:rounded-t-lg group-last/item:rounded-b-lg";

type ListItemContentProps = {
  leading?: ReactNode;
  headline: ReactNode;
  overline?: ReactNode;
  supporting?: ReactNode;
  trailing?: ReactNode;
};

function Content({ leading, headline, overline, supporting, trailing }: ListItemContentProps) {
  return (
    <>
      {leading && <span className="flex shrink-0 items-center text-on-surface-variant">{leading}</span>}
      <span className="flex min-w-0 grow flex-col justify-center">
        {overline && <span className="truncate text-label-md text-on-surface-variant">{overline}</span>}
        <span className="truncate text-body-lg text-on-surface">{headline}</span>
        {supporting && <span className="line-clamp-2 text-body-md text-on-surface-variant">{supporting}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1 text-label-md text-on-surface-variant">{trailing}</span>}
    </>
  );
}

const ROW = "flex min-h-14 w-full items-center gap-4 bg-surface-container px-4 py-2 text-left";

type ListItemProps = ListItemContentProps & {
  href?: AriaLinkProps["href"];
  onAction?: () => void;
  /** Controls placed after the trailing content, outside the pressable area. */
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
};

export function ListItem({ href, onAction, actions, selected, className, ...content }: ListItemProps) {
  const interactive = "state-layer focus-ring-inset cursor-pointer";
  const selectedClass = selected && "bg-secondary-container [&_*]:text-on-secondary-container";
  return (
    <li className={cx("group/item flex", className)}>
      <div className={cx("flex w-full items-center overflow-hidden", ITEM_SHAPE)}>
        {href ? (
          <AriaLink href={href} className={cx(ROW, interactive, selectedClass)}>
            <Content {...content} />
          </AriaLink>
        ) : onAction ? (
          <AriaButton onPress={onAction} className={cx(ROW, interactive, selectedClass)}>
            <Content {...content} />
          </AriaButton>
        ) : (
          <div className={cx(ROW, selectedClass)}>
            <Content {...content} />
          </div>
        )}
        {actions && <div className="flex h-full shrink-0 items-center gap-1 self-stretch bg-surface-container pr-2">{actions}</div>}
      </div>
    </li>
  );
}
