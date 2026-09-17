"use client";

import type { ReactNode } from "react";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
  FieldError,
  Label,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
  Text,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconCheck, iconRemove } from "@/ui/icons/generated";
import { Icon } from "./icon";

const TARGET =
  "relative grid size-10 shrink-0 place-items-center rounded-full before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity";

type CheckboxProps = Omit<AriaCheckboxProps, "className" | "children"> & {
  children?: ReactNode;
  className?: string;
};

export function Checkbox({ children, className, ...props }: CheckboxProps) {
  return (
    <AriaCheckbox
      {...props}
      className={cx("group flex cursor-pointer items-center gap-1 text-body-lg text-on-surface data-[disabled]:cursor-default data-[disabled]:text-on-surface/38", className)}
    >
      {({ isSelected, isIndeterminate, isInvalid, isHovered, isPressed, isFocusVisible, isDisabled }) => {
        const checked = isSelected || isIndeterminate;
        return (
          <>
            <span
              className={cx(
                TARGET,
                checked ? "text-primary" : "text-on-surface",
                isInvalid && "text-error",
                isHovered && "before:opacity-8",
                (isPressed || isFocusVisible) && "before:opacity-10",
                isFocusVisible && "outline-3 outline-offset-0 outline-secondary",
              )}
            >
              <span
                className={cx(
                  "relative grid size-[18px] place-items-center rounded-[2px] border-2 transition-colors duration-150",
                  checked
                    ? "border-transparent bg-primary text-on-primary"
                    : "border-on-surface-variant text-transparent",
                  isInvalid && (checked ? "bg-error text-on-error" : "border-error"),
                  isDisabled && (checked ? "bg-on-surface/38" : "border-on-surface/38"),
                )}
              >
                <Icon
                  icon={isIndeterminate ? iconRemove : iconCheck}
                  size={18}
                  className={cx("transition-transform duration-200 ease-[var(--ease-fast-spatial)]", checked ? "scale-100" : "scale-0")}
                />
              </span>
            </span>
            {children}
          </>
        );
      }}
    </AriaCheckbox>
  );
}

type RadioGroupProps = Omit<AriaRadioGroupProps, "className" | "children"> & {
  label?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function RadioGroup({ label, description, children, className, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup {...props} className={cx("group flex flex-col gap-1", className)}>
      {label && <Label className="text-title-sm text-on-surface-variant">{label}</Label>}
      <div className="flex flex-col group-data-[orientation=horizontal]:flex-row group-data-[orientation=horizontal]:flex-wrap group-data-[orientation=horizontal]:gap-x-4">
        {children}
      </div>
      {description && <Text slot="description" className="text-body-sm text-on-surface-variant">{description}</Text>}
      <FieldError className="text-body-sm text-error" />
    </AriaRadioGroup>
  );
}

type RadioProps = Omit<AriaRadioProps, "className" | "children"> & { children?: ReactNode; className?: string };

export function Radio({ children, className, ...props }: RadioProps) {
  return (
    <AriaRadio
      {...props}
      className={cx("flex cursor-pointer items-center gap-1 text-body-lg text-on-surface data-[disabled]:cursor-default data-[disabled]:text-on-surface/38", className)}
    >
      {({ isSelected, isHovered, isPressed, isFocusVisible, isDisabled }) => (
        <>
          <span
            className={cx(
              TARGET,
              isSelected ? "text-primary" : "text-on-surface",
              isHovered && "before:opacity-8",
              (isPressed || isFocusVisible) && "before:opacity-10",
              isFocusVisible && "outline-3 outline-offset-0 outline-secondary",
            )}
          >
            <span
              className={cx(
                "grid size-5 place-items-center rounded-full border-2 transition-colors",
                isSelected ? "border-primary" : "border-on-surface-variant",
                isDisabled && "border-on-surface/38",
              )}
            >
              <span
                className={cx(
                  "size-2.5 rounded-full bg-primary transition-transform duration-200 ease-[var(--ease-fast-spatial)]",
                  isSelected ? "scale-100" : "scale-0",
                  isDisabled && "bg-on-surface/38",
                )}
              />
            </span>
          </span>
          {children}
        </>
      )}
    </AriaRadio>
  );
}

type SwitchProps = Omit<AriaSwitchProps, "className" | "children"> & {
  children?: ReactNode;
  /** Show a check icon in the handle when on. */
  withIcon?: boolean;
  className?: string;
};

export function Switch({ children, withIcon = true, className, ...props }: SwitchProps) {
  return (
    <AriaSwitch
      {...props}
      className={cx("group flex cursor-pointer items-center justify-between gap-4 text-body-lg text-on-surface data-[disabled]:cursor-default data-[disabled]:text-on-surface/38", className)}
    >
      {({ isSelected, isPressed, isHovered, isFocusVisible, isDisabled }) => (
        <>
          {children}
          <span
            className={cx(
              "relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-2 transition-colors duration-200",
              isSelected ? "border-primary bg-primary" : "border-outline bg-surface-container-highest",
              isDisabled && (isSelected ? "border-transparent bg-on-surface/12" : "border-on-surface/12 bg-surface-container-highest/12"),
              isFocusVisible && "outline-3 outline-offset-2 outline-secondary",
            )}
          >
            <span
              className={cx(
                "absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full transition-all duration-300 ease-[var(--ease-fast-spatial)]",
                "before:absolute before:size-10 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity",
                isHovered && "before:opacity-8",
                isPressed && "before:opacity-10",
                isSelected
                  ? cx("bg-on-primary text-on-primary-container", isPressed ? "left-[20px] size-7" : "left-[22px] size-6")
                  : cx("bg-outline text-surface-container-highest", isPressed ? "left-0.5 size-7" : "left-1.5 size-4"),
                isDisabled && (isSelected ? "bg-surface" : "bg-on-surface/38"),
              )}
            >
              {withIcon && isSelected && <Icon icon={iconCheck} size={16} className="relative" />}
            </span>
          </span>
        </>
      )}
    </AriaSwitch>
  );
}
