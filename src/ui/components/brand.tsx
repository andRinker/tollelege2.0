import { APP_NAME } from "@/lib/brand";
import { cx } from "@/ui/cx";
import { iconAutoStories } from "@/ui/icons/generated";
import { Icon } from "./icon";

type BrandMarkProps = { size?: "md" | "lg"; className?: string };

/** The Tolle Lege wordmark: an open book with the name in rounded Google Sans Flex. */
export function BrandMark({ size = "md", className }: BrandMarkProps) {
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <Icon icon={iconAutoStories} size={size === "lg" ? 32 : 28} filled />
      <span
        className={size === "lg" ? "text-title-lg-em" : "text-title-md-em"}
        style={{ fontVariationSettings: '"ROND" 100' }}
      >
        {APP_NAME}
      </span>
    </span>
  );
}
