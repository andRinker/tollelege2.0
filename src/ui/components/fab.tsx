"use client";

import { type ReactNode, useState } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger as AriaMenuTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconAdd, iconClose, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";

export type FabColor = "primary-container" | "secondary-container" | "tertiary-container" | "primary" | "secondary" | "tertiary";

const COLORS: Record<FabColor, string> = {
  "primary-container": "bg-primary-container text-on-primary-container",
  "secondary-container": "bg-secondary-container text-on-secondary-container",
  "tertiary-container": "bg-tertiary-container text-on-tertiary-container",
  primary: "bg-primary text-on-primary",
  secondary: "bg-secondary text-on-secondary",
  tertiary: "bg-tertiary text-on-tertiary",
};

type FabSize = "fab" | "medium" | "large";

const SIZES: Record<FabSize, { box: string; extended: string; icon: number }> = {
  fab: { box: "size-14 rounded-lg", extended: "h-14 gap-2 rounded-lg px-4 text-title-md", icon: 24 },
  medium: { box: "size-20 rounded-lg-plus", extended: "h-20 gap-3 rounded-lg-plus px-[26px] text-title-lg", icon: 28 },
  large: { box: "size-24 rounded-xl", extended: "h-24 gap-4 rounded-xl px-7 text-headline-sm", icon: 36 },
};

const BASE =
  "state-layer focus-ring relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap shadow-3 transition-shadow data-[hovered]:shadow-4";

type FabCommon = {
  icon: IconData;
  size?: FabSize;
  color?: FabColor;
  className?: string;
};

type FabProps = FabCommon & { label: string } & (
    | ({ href: AriaLinkProps["href"] } & Omit<AriaLinkProps, "className" | "children">)
    | ({ href?: undefined } & Omit<AriaButtonProps, "className" | "children">)
  );

export function Fab({ icon, label, size = "fab", color = "primary-container", className, ...props }: FabProps) {
  const classes = cx(BASE, SIZES[size].box, COLORS[color], className);
  const content = <Icon icon={icon} size={SIZES[size].icon} />;
  return props.href !== undefined ? (
    <AriaLink {...(props as AriaLinkProps)} aria-label={label} className={classes}>
      {content}
    </AriaLink>
  ) : (
    <AriaButton {...(props as AriaButtonProps)} aria-label={label} className={classes}>
      {content}
    </AriaButton>
  );
}

type ExtendedFabProps = FabCommon & { children: ReactNode } & (
    | ({ href: AriaLinkProps["href"] } & Omit<AriaLinkProps, "className" | "children">)
    | ({ href?: undefined } & Omit<AriaButtonProps, "className" | "children">)
  );

export function ExtendedFab({ icon, size = "fab", color = "primary-container", className, children, ...props }: ExtendedFabProps) {
  const classes = cx(BASE, SIZES[size].extended, COLORS[color], className);
  const content = (
    <>
      <Icon icon={icon} size={SIZES[size].icon} />
      {children}
    </>
  );
  return props.href !== undefined ? (
    <AriaLink {...(props as AriaLinkProps)} className={classes}>
      {content}
    </AriaLink>
  ) : (
    <AriaButton {...(props as AriaButtonProps)} className={classes}>
      {content}
    </AriaButton>
  );
}

export type FabMenuItem = {
  id: string;
  label: string;
  icon: IconData;
  href?: string;
  onAction?: () => void;
};

type FabMenuProps = {
  label: string;
  icon?: IconData;
  items: FabMenuItem[];
  className?: string;
};

/** M3 Expressive FAB menu: the FAB turns into a close button and actions rise above it. */
export function FabMenu({ label, icon = iconAdd, items, className }: FabMenuProps) {
  const [isOpen, setOpen] = useState(false);
  return (
    <AriaMenuTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <AriaButton
        aria-label={isOpen ? `Close ${label.toLowerCase()}` : label}
        className={cx(
          "state-layer focus-ring relative grid size-14 shrink-0 cursor-pointer place-items-center shadow-3",
          "transition-[border-radius,background-color,color] duration-350 ease-[var(--ease-standard-spatial)]",
          isOpen ? "rounded-[28px] bg-primary text-on-primary" : "rounded-lg bg-primary-container text-on-primary-container",
          className,
        )}
      >
        <Icon
          icon={isOpen ? iconClose : icon}
          className={cx("transition-transform duration-350 ease-[var(--ease-fast-spatial)]", isOpen ? "rotate-0" : "rotate-90")}
        />
      </AriaButton>
      <AriaPopover placement="top end" offset={8} className="outline-none">
        <AriaMenu
          aria-label={label}
          className="flex flex-col items-end gap-1 outline-none"
          onAction={(key) => items.find((item) => item.id === key)?.onAction?.()}
        >
          {items.map((item, index) => (
            <AriaMenuItem
              key={item.id}
              id={item.id}
              href={item.href}
              textValue={item.label}
              style={{ animationDelay: `${(items.length - 1 - index) * 40}ms` }}
              className="state-layer focus-ring relative flex h-14 cursor-pointer items-center gap-2 rounded-full bg-primary-container px-6 text-title-md text-on-primary-container shadow-3 outline-none animate-[fab-item-in_400ms_var(--ease-default-spatial)_both] data-[focused]:before:opacity-10"
            >
              <Icon icon={item.icon} />
              {item.label}
            </AriaMenuItem>
          ))}
        </AriaMenu>
      </AriaPopover>
    </AriaMenuTrigger>
  );
}
