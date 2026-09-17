import { cx } from "@/ui/cx";
import type { IconData } from "@/ui/icons/generated";

type IconProps = {
  icon: IconData;
  /** Filled glyphs mark selected or active states. */
  filled?: boolean;
  size?: number;
  /** Omit for decorative icons; they're hidden from assistive technology. */
  label?: string;
  className?: string;
};

export function Icon({ icon, filled = false, size = 24, label, className }: IconProps) {
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={cx("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={filled ? icon[1] : icon[0]} />
    </svg>
  );
}
