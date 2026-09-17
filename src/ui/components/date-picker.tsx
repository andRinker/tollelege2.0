"use client";

import type { DateValue } from "@internationalized/date";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  type DatePickerProps as AriaDatePickerProps,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconCalendarMonth, iconChevronLeft, iconChevronRight } from "@/ui/icons/generated";
import { Icon } from "./icon";
import { Popover } from "./menu";
import { type FieldVariant, FieldSupport, fieldContainerClasses } from "./text-field";

type DatePickerProps<T extends DateValue> = Omit<AriaDatePickerProps<T>, "className" | "children"> & {
  label: string;
  description?: ReactNode;
  variant?: FieldVariant;
  className?: string;
};

const NAV_BUTTON =
  "state-layer focus-ring grid size-10 cursor-pointer place-items-center rounded-full text-on-surface-variant data-[disabled]:text-on-surface/38";

/** Docked date picker: an editable date field with a calendar popover. */
export function DatePicker<T extends DateValue>({ label, description, variant = "filled", className, ...props }: DatePickerProps<T>) {
  return (
    <AriaDatePicker {...props} className={cx("group/root flex flex-col", className)}>
      <Group className={cx(fieldContainerClasses(variant), "items-center")}>
        <Label className="pointer-events-none absolute top-2 left-4 text-body-sm text-on-surface-variant group-focus-within/field:text-primary group-data-[invalid]/root:text-error">
          {label}
        </Label>
        <DateInput className="flex grow pt-6 pb-2 pl-4 text-body-lg">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded-xs px-0.5 tabular-nums caret-transparent outline-none data-[placeholder]:text-on-surface-variant data-[focused]:bg-primary data-[focused]:text-on-primary data-[type=literal]:px-0"
            />
          )}
        </DateInput>
        <AriaButton aria-label="Open calendar" className={cx(NAV_BUTTON, "mr-1")}>
          <Icon icon={iconCalendarMonth} />
        </AriaButton>
      </Group>
      <FieldSupport description={description} />
      <Popover placement="bottom end" className="p-3">
        <Dialog className="outline-none">
          <Calendar className="flex w-[304px] flex-col gap-2">
            <header className="flex items-center justify-between pl-3">
              <Heading className="text-title-sm text-on-surface-variant" />
              <div className="flex">
                <AriaButton slot="previous" className={NAV_BUTTON}>
                  <Icon icon={iconChevronLeft} />
                </AriaButton>
                <AriaButton slot="next" className={NAV_BUTTON}>
                  <Icon icon={iconChevronRight} />
                </AriaButton>
              </div>
            </header>
            <CalendarGrid className="border-separate border-spacing-0.5">
              <CalendarGridHeader>
                {(day) => <CalendarHeaderCell className="size-10 text-body-lg text-on-surface">{day}</CalendarHeaderCell>}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => (
                  <CalendarCell
                    date={date}
                    className={cx(
                      "state-layer focus-ring grid size-10 cursor-pointer place-items-center rounded-full text-body-lg text-on-surface",
                      "data-[outside-month]:hidden data-[disabled]:text-on-surface/38 data-[unavailable]:text-on-surface/38",
                      "data-[today]:border data-[today]:border-primary data-[today]:text-primary",
                      "data-[selected]:border-transparent data-[selected]:bg-primary data-[selected]:text-on-primary",
                    )}
                  />
                )}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
}
