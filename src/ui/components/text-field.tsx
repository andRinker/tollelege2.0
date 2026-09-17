"use client";

import type { ReactNode, Ref } from "react";
import {
  Button as AriaButton,
  FieldError,
  Input,
  Label,
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
  Text,
  TextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconClose, iconError, iconSearch, type IconData } from "@/ui/icons/generated";
import { Icon } from "./icon";

export type FieldVariant = "filled" | "outlined";

/** Container styles shared by text fields, selects, comboboxes, and date pickers. */
export function fieldContainerClasses(variant: FieldVariant) {
  return cx(
    "group/field relative flex min-h-14 w-full items-stretch text-on-surface transition-colors",
    variant === "filled"
      ? [
          "rounded-t-xs bg-surface-container-highest",
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-on-surface-variant after:transition-[height,background-color]",
          "hover:after:bg-on-surface focus-within:after:h-0.5 focus-within:after:bg-primary",
          "group-data-[invalid]/root:after:bg-error",
          "state-layer",
        ].join(" ")
      : [
          "rounded-xs border border-outline",
          "hover:border-on-surface focus-within:border-2 focus-within:border-primary focus-within:-m-px",
          "group-data-[invalid]/root:border-error",
        ].join(" "),
    "group-data-[disabled]/root:opacity-38 group-data-[disabled]/root:pointer-events-none",
  );
}

/** A label that rests inside the field and floats when focused or filled. */
export function floatingLabelClasses(variant: FieldVariant, hasLeadingIcon: boolean) {
  return cx(
    "pointer-events-none absolute top-1/2 origin-left -translate-y-1/2 truncate text-body-lg text-on-surface-variant transition-all duration-150 ease-[var(--ease-fast-effects)]",
    hasLeadingIcon ? "left-13" : "left-4",
    "max-w-[calc(100%-32px)]",
    "group-focus-within/field:text-primary group-data-[invalid]/root:text-error",
    variant === "filled"
      ? "group-focus-within/field:top-2 group-focus-within/field:translate-y-0 group-focus-within/field:text-body-sm group-has-[input:not(:placeholder-shown)]/field:top-2 group-has-[input:not(:placeholder-shown)]/field:translate-y-0 group-has-[input:not(:placeholder-shown)]/field:text-body-sm group-has-[textarea:not(:placeholder-shown)]/field:top-2 group-has-[textarea:not(:placeholder-shown)]/field:translate-y-0 group-has-[textarea:not(:placeholder-shown)]/field:text-body-sm group-has-[[data-filled]]/field:top-2 group-has-[[data-filled]]/field:translate-y-0 group-has-[[data-filled]]/field:text-body-sm"
      : "bg-[var(--field-bg,var(--md-sys-color-surface))] px-1 -ml-1 group-focus-within/field:top-0 group-focus-within/field:text-body-sm group-has-[input:not(:placeholder-shown)]/field:top-0 group-has-[input:not(:placeholder-shown)]/field:text-body-sm group-has-[textarea:not(:placeholder-shown)]/field:top-0 group-has-[textarea:not(:placeholder-shown)]/field:text-body-sm group-has-[[data-filled]]/field:top-0 group-has-[[data-filled]]/field:text-body-sm",
  );
}

export function inputClasses(variant: FieldVariant, hasLeadingIcon: boolean, hasTrailing: boolean) {
  return cx(
    "min-w-0 grow bg-transparent text-body-lg text-on-surface caret-primary outline-none placeholder:text-on-surface-variant placeholder:opacity-0 focus:placeholder:opacity-100",
    hasLeadingIcon ? "pl-13" : "pl-4",
    hasTrailing ? "pr-13" : "pr-4",
    variant === "filled" ? "pt-6 pb-2" : "py-4",
  );
}

export function FieldSupport({ description, errorMessage }: { description?: ReactNode; errorMessage?: string }) {
  return (
    <>
      {description && (
        <Text slot="description" className="px-4 pt-1 text-body-sm text-on-surface-variant group-data-[invalid]/root:hidden">
          {description}
        </Text>
      )}
      <FieldError className="px-4 pt-1 text-body-sm text-error">{errorMessage}</FieldError>
    </>
  );
}

type TextFieldProps = Omit<AriaTextFieldProps, "className" | "children"> & {
  label: string;
  description?: ReactNode;
  /** Shown when the field is invalid. Defaults to the browser or validate() message. */
  errorMessage?: string;
  variant?: FieldVariant;
  leadingIcon?: IconData;
  /** Rendered at the trailing edge, e.g. an icon button. */
  trailing?: ReactNode;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
};

export function TextField({
  label,
  description,
  errorMessage,
  variant = "filled",
  leadingIcon,
  trailing,
  placeholder,
  multiline = false,
  rows = 3,
  className,
  inputClassName,
  inputRef,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField {...props} className={cx("group/root flex flex-col", className)}>
      {({ isInvalid }) => (
        <>
          <div className={fieldContainerClasses(variant)}>
            {leadingIcon && (
              <Icon icon={leadingIcon} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-on-surface-variant" />
            )}
            <Label className={cx(floatingLabelClasses(variant, Boolean(leadingIcon)), multiline && "top-7")}>{label}</Label>
            {multiline ? (
              <TextArea
                rows={rows}
                placeholder={placeholder ?? " "}
                className={cx(inputClasses(variant, Boolean(leadingIcon), false), "resize-none pt-7", inputClassName)}
              />
            ) : (
              <Input
                ref={inputRef}
                placeholder={placeholder ?? " "}
                className={cx(inputClasses(variant, Boolean(leadingIcon), Boolean(trailing) || isInvalid), inputClassName)}
              />
            )}
            {(trailing || isInvalid) && !multiline && (
              <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
                {isInvalid ? <Icon icon={iconError} className="mr-3 text-error" /> : trailing}
              </div>
            )}
          </div>
          <FieldSupport description={description} errorMessage={errorMessage} />
        </>
      )}
    </AriaTextField>
  );
}

type SearchFieldProps = Omit<AriaSearchFieldProps, "className" | "children"> & {
  placeholder: string;
  /** Extra controls after the clear button, e.g. a scan button. */
  trailing?: ReactNode;
  className?: string;
};

/** M3 Expressive search bar. */
export function SearchField({ placeholder, trailing, className, ...props }: SearchFieldProps) {
  return (
    <AriaSearchField {...props} className={cx("group/search w-full", className)}>
      <div className="flex h-14 w-full items-center gap-1 rounded-full bg-surface-container-high pr-1 pl-4 text-on-surface transition-shadow focus-within:shadow-1">
        <Icon icon={iconSearch} className="shrink-0 text-on-surface-variant" />
        <Input
          aria-label={props["aria-label"] ?? placeholder}
          placeholder={placeholder}
          className="h-full min-w-0 grow bg-transparent px-3 text-body-lg outline-none placeholder:text-on-surface-variant [&::-webkit-search-cancel-button]:hidden"
        />
        <AriaButton
          aria-label="Clear search"
          className="state-layer focus-ring grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-on-surface-variant group-data-[empty]/search:hidden"
        >
          <Icon icon={iconClose} />
        </AriaButton>
        {trailing}
      </div>
    </AriaSearchField>
  );
}
