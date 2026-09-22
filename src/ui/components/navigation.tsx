"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Link as AriaLink } from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconMenu, iconMenuOpen, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { Badge } from "./surfaces";

export type NavDestination = {
  href: string;
  label: string;
  icon: IconData;
  /** Shown on the icon when something is waiting there. Hidden at zero. */
  badge?: { count: number; label: string };
};

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

// Active indicator pill: expands from its center when the destination becomes active.
const INDICATOR =
  "absolute inset-0 -z-10 rounded-full bg-secondary-container opacity-0 scale-x-50 transition-[transform,opacity] duration-350 ease-[var(--ease-fast-spatial)] group-aria-[current=page]/nav:scale-x-100 group-aria-[current=page]/nav:opacity-100";

// State layer on the pill, driven by the whole item's interaction state.
const PILL_STATES =
  "before:absolute before:inset-0 before:-z-[5] before:rounded-full before:bg-current before:opacity-0 before:transition-opacity group-data-[hovered]/nav:before:opacity-8 group-data-[pressed]/nav:before:opacity-10 group-data-[focus-visible]/nav:before:opacity-10";

function VerticalItem({ destination, active, compact }: { destination: NavDestination; active: boolean; compact?: boolean }) {
  return (
    <AriaLink
      href={destination.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group/nav flex cursor-pointer flex-col items-center gap-1 outline-none data-[focus-visible]:[&>span:first-child]:outline-3 data-[focus-visible]:[&>span:first-child]:outline-secondary",
        // `flex-auto`, not `flex-1`: each destination starts at the width its own label
        // needs and only then shares what's left. An equal sixth of a 360px phone is 60px,
        // which "Check out" misses by a hair — and by a different hair on every renderer.
        compact ? "flex-auto px-0.5 py-1.5" : "w-full pb-1",
      )}
    >
      <span
        className={cx(
          "relative isolate grid h-8 place-items-center rounded-full text-on-surface-variant group-aria-[current=page]/nav:text-on-secondary-container",
          // Six destinations' worth of 56px pills overflow a 320px bar.
          compact ? "w-12" : "w-14",
          PILL_STATES,
        )}
      >
        <span className={INDICATOR} />
        <Icon icon={destination.icon} filled={active} />
        {Boolean(destination.badge?.count) && (
          <Badge
            count={destination.badge?.count}
            label={destination.badge?.label}
            className={cx("absolute top-0", compact ? "right-1.5" : "right-3")}
          />
        )}
      </span>
      <span
        className={cx(
          "max-w-full truncate text-on-surface-variant group-aria-[current=page]/nav:text-secondary",
          // Label Small on the bar: six destinations' worth of Label Medium doesn't fit a
          // phone even once each one is sized to its own label.
          compact
            ? "text-center text-label-sm group-aria-[current=page]/nav:text-label-sm-em"
            : "px-1 text-label-md group-aria-[current=page]/nav:text-label-md-em",
        )}
      >
        {destination.label}
      </span>
    </AriaLink>
  );
}

function HorizontalItem({ destination, active }: { destination: NavDestination; active: boolean }) {
  return (
    <AriaLink
      href={destination.href}
      aria-current={active ? "page" : undefined}
      className="group/nav flex h-14 cursor-pointer items-center outline-none data-[focus-visible]:[&>span]:outline-3 data-[focus-visible]:[&>span]:outline-secondary"
    >
      <span
        className={cx(
          "relative isolate flex h-14 items-center gap-2 rounded-full px-4 text-on-surface-variant group-aria-[current=page]/nav:text-on-secondary-container",
          PILL_STATES,
        )}
      >
        <span className={INDICATOR} />
        <Icon icon={destination.icon} filled={active} />
        <span className="text-label-lg group-aria-[current=page]/nav:text-label-lg-em">{destination.label}</span>
        {Boolean(destination.badge?.count) && (
          <Badge count={destination.badge?.count} label={destination.badge?.label} className="ml-auto" />
        )}
      </span>
    </AriaLink>
  );
}

type NavigationRailProps = {
  destinations: NavDestination[];
  /** Destinations pinned to the bottom, such as Settings. */
  footerDestinations?: NavDestination[];
  expanded: boolean;
  onToggle: () => void;
  /** A FAB or extended FAB below the menu button. */
  fab?: ReactNode;
};

/** Collapsed (96px) or expanded (280px) navigation rail for medium and larger windows. */
export function NavigationRail({ destinations, footerDestinations = [], expanded, onToggle, fab }: NavigationRailProps) {
  const isActive = useIsActive();
  return (
    <nav
      aria-label="Main"
      className={cx(
        "fixed inset-y-0 left-0 z-30 hidden flex-col overflow-x-hidden overflow-y-auto bg-surface pt-11 pb-5 medium:flex",
        "transition-[width] duration-350 ease-[var(--ease-default-spatial)]",
        expanded ? "w-[280px] px-3" : "w-24 items-center",
      )}
    >
      <div className={cx("mb-10 flex flex-col gap-4", expanded ? "items-start pl-1" : "items-center")}>
        <IconButton
          icon={expanded ? iconMenuOpen : iconMenu}
          label={expanded ? "Collapse navigation" : "Expand navigation"}
          onPress={onToggle}
          aria-expanded={expanded}
        />
        {fab}
      </div>
      <ul className={cx("flex flex-col", expanded ? "gap-0" : "w-full gap-1")}>
        {destinations.map((destination) => (
          <li key={destination.href}>
            {expanded ? (
              <HorizontalItem destination={destination} active={isActive(destination.href)} />
            ) : (
              <VerticalItem destination={destination} active={isActive(destination.href)} />
            )}
          </li>
        ))}
      </ul>
      {footerDestinations.length > 0 && (
        <ul className={cx("mt-auto flex flex-col pt-6", !expanded && "w-full")}>
          {footerDestinations.map((destination) => (
            <li key={destination.href}>
              {expanded ? (
                <HorizontalItem destination={destination} active={isActive(destination.href)} />
              ) : (
                <VerticalItem destination={destination} active={isActive(destination.href)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/** Bottom navigation bar for compact windows. */
export function NavigationBar({ destinations }: { destinations: NavDestination[] }) {
  const isActive = useIsActive();
  return (
    <nav
      aria-label="Main"
      data-nav-bar=""
      className="fixed inset-x-0 bottom-0 z-30 flex bg-surface-container pb-[env(safe-area-inset-bottom)] medium:hidden"
    >
      {destinations.map((destination) => (
        <VerticalItem key={destination.href} destination={destination} active={isActive(destination.href)} compact />
      ))}
    </nav>
  );
}
