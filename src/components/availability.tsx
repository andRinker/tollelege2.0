import { cx } from "@/ui/cx";

type AvailabilityProps = { available: number; total: number; className?: string };

export function availabilityText(available: number, total: number): string {
  if (total === 0) return "No copies in circulation";
  if (available === total) return total === 1 ? "Available" : `All ${total} available`;
  if (available === 0) return total === 1 ? "Checked out" : `All ${total} checked out`;
  return `${available} of ${total} available`;
}

/** A colored dot and short phrase describing how many copies are on the shelf. */
export function Availability({ available, total, className }: AvailabilityProps) {
  const tone = total === 0 ? "bg-outline" : available === 0 ? "bg-error" : available === total ? "bg-primary" : "bg-tertiary";
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-label-md text-on-surface-variant", className)}>
      <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", tone)} />
      {availabilityText(available, total)}
    </span>
  );
}
