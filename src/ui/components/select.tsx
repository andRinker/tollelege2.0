"use client";

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  type ComboBoxProps as AriaComboBoxProps,
  Input,
  Label,
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  SelectValue,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconArrowDropDown, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";
import { ListBox, Popover } from "./menu";
import { type FieldVariant, FieldSupport, fieldContainerClasses, floatingLabelClasses, inputClasses } from "./text-field";

type SelectProps<T extends object> = Omit<AriaSelectProps<T>, "className" | "children"> & {
  label: string;
  description?: ReactNode;
  variant?: FieldVariant;
  items?: Iterable<T>;
  children: ReactNode | ((item: T) => ReactNode);
  className?: string;
};

export function Select<T extends object>({ label, description, variant = "filled", items, children, className, ...props }: SelectProps<T>) {
  return (
    <AriaSelect {...props} className={cx("group/root flex flex-col", className)}>
      <AriaButton className={cx(fieldContainerClasses(variant), "cursor-pointer text-left outline-none")}>
        <Label className={floatingLabelClasses(variant, false)}>{label}</Label>
        <SelectValue
          className={cx(
            inputClasses(variant, false, true),
            "flex items-center truncate data-[placeholder]:text-transparent",
          )}
        >
          {({ isPlaceholder, defaultChildren }) => (
            <span data-filled={isPlaceholder ? undefined : ""} className="truncate">
              {isPlaceholder ? " " : defaultChildren}
            </span>
          )}
        </SelectValue>
        <Icon
          icon={iconArrowDropDown}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant transition-transform group-data-[open]/root:rotate-180"
        />
      </AriaButton>
      <FieldSupport description={description} />
      <Popover className="w-(--trigger-width)" placement="bottom start">
        <ListBox items={items}>{children}</ListBox>
      </Popover>
    </AriaSelect>
  );
}

type ComboBoxProps<T extends object> = Omit<AriaComboBoxProps<T>, "className" | "children"> & {
  label: string;
  description?: ReactNode;
  variant?: FieldVariant;
  leadingIcon?: IconData;
  placeholder?: string;
  children: ReactNode | ((item: T) => ReactNode);
  className?: string;
};

export function ComboBox<T extends object>({
  label,
  description,
  variant = "filled",
  leadingIcon,
  placeholder,
  children,
  className,
  ...props
}: ComboBoxProps<T>) {
  return (
    <AriaComboBox {...props} className={cx("group/root flex flex-col", className)}>
      <div className={fieldContainerClasses(variant)}>
        {leadingIcon && (
          <Icon icon={leadingIcon} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-on-surface-variant" />
        )}
        <Label className={floatingLabelClasses(variant, Boolean(leadingIcon))}>{label}</Label>
        <Input placeholder={placeholder ?? " "} className={inputClasses(variant, Boolean(leadingIcon), true)} />
        <AriaButton className="state-layer absolute top-1/2 right-1 grid size-12 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-on-surface-variant">
          <Icon icon={iconArrowDropDown} className="transition-transform group-data-[open]/root:rotate-180" />
        </AriaButton>
      </div>
      <FieldSupport description={description} />
      <Popover className="w-(--trigger-width)" placement="bottom start">
        <ListBox renderEmptyState={() => <p className="px-3 py-2 text-body-md text-on-surface-variant">No matches</p>}>
          {children}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
