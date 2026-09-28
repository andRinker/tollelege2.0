"use client";

import { BookCover } from "@/components/book-cover";
import type { SeriesStack } from "@/server/catalog";
import { cx } from "@/ui/cx";

/** The first book's cover with two more behind it, so a series reads as a pile of books. */
export function StackCover({ stack, size }: { stack: SeriesStack; size?: "sm" }) {
  const offset = size === "sm" ? "translate-x-0.5 -translate-y-0.5" : "translate-x-1.5 -translate-y-1.5";
  const further = size === "sm" ? "translate-x-1 -translate-y-1" : "translate-x-3 -translate-y-3";
  return (
    <div className={cx("relative", size === "sm" ? "mt-1 mr-1" : "mt-3 mr-3")}>
      <div aria-hidden="true" className={cx("absolute inset-0 rounded-md bg-surface-container-highest shadow-1", further)} />
      <div aria-hidden="true" className={cx("absolute inset-0 rounded-md bg-surface-container-high shadow-1", offset)} />
      <div className="relative">
        <BookCover title={stack.first.title} coverUrl={stack.first.coverUrl} size={size} />
      </div>
    </div>
  );
}
