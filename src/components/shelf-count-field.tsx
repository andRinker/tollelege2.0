"use client";

import { TextField } from "@/ui/components/text-field";

/**
 * The teacher's optional count of books on a shelf, before a photo is taken. Shared by the
 * shelf dialog and the paired phone, so a shelf is asked about the same way from either.
 */
export function ShelfCountField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <TextField
      label="How many books on this shelf? (optional)"
      description="Count every spine, copies too. The scan checks itself against it, and looks again if it comes up short."
      value={value}
      onChange={(next) => onChange(next.replace(/\D/g, "").slice(0, 3))}
      inputMode="numeric"
      autoComplete="off"
      inputClassName="tabular-nums"
    />
  );
}
