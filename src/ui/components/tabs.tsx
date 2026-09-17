"use client";

import { motion } from "motion/react";
import { createContext, type ReactNode, useContext, useId } from "react";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  type TabListProps as AriaTabListProps,
  TabPanel as AriaTabPanel,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  Tabs as AriaTabs,
  type TabsProps as AriaTabsProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import type { IconData } from "@/ui/icons/generated";
import { springs } from "@/ui/motion/tokens";
import { Icon } from "./icon";

const TabsIdContext = createContext("tabs");

export function Tabs({ className, ...props }: Omit<AriaTabsProps, "className"> & { className?: string }) {
  const id = useId();
  return (
    <TabsIdContext value={id}>
      <AriaTabs {...props} className={cx("flex flex-col", className)} />
    </TabsIdContext>
  );
}

export function TabList<T extends object>({ className, ...props }: Omit<AriaTabListProps<T>, "className"> & { className?: string }) {
  return <AriaTabList {...props} className={cx("flex border-b border-outline-variant", className)} />;
}

type TabProps = Omit<AriaTabProps, "className" | "children"> & { icon?: IconData; children: ReactNode; className?: string };

/** Primary tab with an indicator that slides between tabs. */
export function Tab({ icon, children, className, ...props }: TabProps) {
  const groupId = useContext(TabsIdContext);
  return (
    <AriaTab
      {...props}
      className={cx(
        "state-layer focus-ring-inset relative flex h-12 min-w-24 flex-1 cursor-pointer items-center justify-center px-4 text-title-sm text-on-surface-variant outline-none data-[selected]:text-primary data-[disabled]:cursor-default data-[disabled]:text-on-surface/38",
        className,
      )}
    >
      {({ isSelected }) => (
        <span className="relative flex h-full items-center gap-2">
          {icon && <Icon icon={icon} size={24} filled={isSelected} />}
          {children}
          {isSelected && (
            <motion.span
              layoutId={`${groupId}-indicator`}
              transition={springs.fastSpatial}
              className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-[3px] bg-primary"
            />
          )}
        </span>
      )}
    </AriaTab>
  );
}

export function TabPanel({ className, ...props }: Omit<AriaTabPanelProps, "className"> & { className?: string }) {
  return <AriaTabPanel {...props} className={cx("outline-none", className)} />;
}
