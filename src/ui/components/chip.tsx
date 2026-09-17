"use client";

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Tag,
  TagGroup,
  type TagGroupProps,
  TagList,
  ToggleButton as AriaToggleButton,
  type ToggleButtonProps as AriaToggleButtonProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconCheck, iconClose, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";

const CHIP =
  "state-layer focus-ring touch-target relative inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 rounded-sm px-4 text-label-lg whitespace-nowrap transition-colors data-[disabled]:cursor-default data-[disabled]:text-on-surface/38";

type AssistChipProps = Omit<AriaButtonProps, "className" | "children"> & {
  icon?: IconData;
  children: ReactNode;
  elevated?: boolean;
  className?: string;
};

export function AssistChip({ icon, children, elevated, className, ...props }: AssistChipProps) {
  return (
    <AriaButton
      {...props}
      className={cx(
        CHIP,
        icon && "pl-2",
        elevated ? "bg-surface-container-low shadow-1" : "border border-outline-variant",
        "text-on-surface",
        className,
      )}
    >
      {icon && <Icon icon={icon} size={18} className="text-primary" />}
      {children}
    </AriaButton>
  );
}

type FilterChipProps = Omit<AriaToggleButtonProps, "className" | "children"> & {
  children: ReactNode;
  className?: string;
};

export function FilterChip({ children, className, ...props }: FilterChipProps) {
  return (
    <AriaToggleButton
      {...props}
      className={cx(
        CHIP,
        "border border-outline-variant text-on-surface-variant",
        "data-[selected]:border-transparent data-[selected]:bg-secondary-container data-[selected]:pl-2 data-[selected]:text-on-secondary-container",
        className,
      )}
    >
      {({ isSelected }) => (
        <>
          {isSelected && <Icon icon={iconCheck} size={18} />}
          {children}
        </>
      )}
    </AriaToggleButton>
  );
}

type InputChipGroupProps<T extends object> = Omit<TagGroupProps, "className" | "children"> & {
  label: string;
  items: Iterable<T & { id: string; name: string }>;
  className?: string;
};

/** Removable chips, such as a book's tags. Pass `onRemove` to make them removable. */
export function InputChipGroup<T extends object>({ label, items, className, ...props }: InputChipGroupProps<T>) {
  return (
    <TagGroup {...props} aria-label={label} className={cx("flex flex-col", className)}>
      <TagList items={items} className="flex flex-wrap gap-2">
        {(item) => (
          <Tag
            id={item.id}
            textValue={item.name}
            className={cx(CHIP, "border border-outline-variant pr-2 text-on-surface-variant data-[focus-visible]:outline-3 data-[focus-visible]:outline-secondary")}
          >
            {({ allowsRemoving }) => (
              <>
                {item.name}
                {allowsRemoving && (
                  <AriaButton slot="remove" className="grid size-5 cursor-pointer place-items-center rounded-full hover:bg-on-surface/10">
                    <Icon icon={iconClose} size={18} />
                  </AriaButton>
                )}
              </>
            )}
          </Tag>
        )}
      </TagList>
    </TagGroup>
  );
}
