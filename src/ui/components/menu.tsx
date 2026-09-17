"use client";

import type { ReactNode } from "react";
import {
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type ListBoxItemProps as AriaListBoxItemProps,
  type ListBoxProps as AriaListBoxProps,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  MenuSection as AriaMenuSection,
  MenuTrigger as AriaMenuTrigger,
  type MenuTriggerProps,
  Popover as AriaPopover,
  type PopoverProps as AriaPopoverProps,
  Separator,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconCheck, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";

// M3 Expressive vertical menu (m3.material.io › Menus › Specs).
const POPOVER =
  "min-w-[128px] max-w-[min(320px,calc(100vw-24px))] overflow-auto rounded-lg bg-surface-container-low p-1 shadow-2 outline-none origin-[var(--trigger-anchor-point)] data-[entering]:animate-[menu-in_250ms_var(--ease-default-spatial)] data-[exiting]:animate-[menu-out_120ms_var(--ease-fast-effects)]";

const ITEM =
  "state-layer focus-ring-inset relative flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-label-lg text-on-surface outline-none data-[focused]:before:opacity-10 data-[disabled]:cursor-default data-[disabled]:text-on-surface/38 data-[selected]:rounded-md data-[selected]:bg-tertiary-container data-[selected]:text-on-tertiary-container";

export function Popover({ className, offset = 4, ...props }: Omit<AriaPopoverProps, "className"> & { className?: string }) {
  return <AriaPopover {...props} offset={offset} className={cx(POPOVER, className)} />;
}

export function MenuTrigger(props: MenuTriggerProps) {
  return <AriaMenuTrigger {...props} />;
}

export function Menu<T extends object>({ className, ...props }: Omit<AriaMenuProps<T>, "className"> & { className?: string }) {
  return (
    <Popover placement="bottom end">
      <AriaMenu {...props} className={cx("flex flex-col gap-0.5 outline-none", className)} />
    </Popover>
  );
}

type MenuItemProps = Omit<AriaMenuItemProps, "className" | "children"> & {
  icon?: IconData;
  children: ReactNode;
  /** Trailing text, such as a keyboard shortcut or count. */
  trailing?: ReactNode;
  destructive?: boolean;
  className?: string;
};

export function MenuItem({ icon, children, trailing, destructive, className, ...props }: MenuItemProps) {
  const textValue = props.textValue ?? (typeof children === "string" ? children : undefined);
  return (
    <AriaMenuItem {...props} textValue={textValue} className={cx(ITEM, destructive && "text-error", className)}>
      {({ isSelected, selectionMode }) => (
        <>
          {selectionMode !== "none" && isSelected ? (
            <Icon icon={iconCheck} size={20} />
          ) : (
            icon && <Icon icon={icon} size={20} className={destructive ? "text-error" : "text-on-surface-variant"} />
          )}
          <span className="grow truncate">{children}</span>
          {trailing && <span className="text-label-lg text-on-surface-variant">{trailing}</span>}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSection({ children, className }: { children: ReactNode; className?: string }) {
  return <AriaMenuSection className={cx("flex flex-col gap-0.5", className)}>{children}</AriaMenuSection>;
}

export function MenuDivider() {
  return <Separator className="my-1 border-t border-outline-variant" />;
}

/** Options list for selects and comboboxes, styled like the menu. */
export function ListBox<T extends object>({ className, ...props }: Omit<AriaListBoxProps<T>, "className"> & { className?: string }) {
  return <AriaListBox {...props} className={cx("flex max-h-80 flex-col gap-0.5 outline-none", className)} />;
}

type ListBoxItemProps = Omit<AriaListBoxItemProps, "className" | "children"> & {
  children: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function ListBoxItem({ children, description, className, ...props }: ListBoxItemProps) {
  const textValue = props.textValue ?? (typeof children === "string" ? children : undefined);
  return (
    <AriaListBoxItem {...props} textValue={textValue} className={cx(ITEM, Boolean(description) && "py-2", className)}>
      {({ isSelected }) => (
        <>
          <span className="flex grow flex-col truncate">
            <span className="truncate">{children}</span>
            {description && <span className="truncate text-body-sm text-on-surface-variant">{description}</span>}
          </span>
          {isSelected && <Icon icon={iconCheck} size={20} />}
        </>
      )}
    </AriaListBoxItem>
  );
}
