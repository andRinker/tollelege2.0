"use client";

import { useState } from "react";
import { cx } from "@/ui/cx";
import { Shape } from "@/ui/components/expressive";
import type { ShapeName } from "@/ui/shapes/shapes";

const PLACEHOLDERS: Array<{ container: string; shape: string; text: string; shapeName: ShapeName }> = [
  { container: "bg-primary-container", shape: "fill-primary/15", text: "text-on-primary-container", shapeName: "cookie9" },
  { container: "bg-secondary-container", shape: "fill-secondary/15", text: "text-on-secondary-container", shapeName: "clover4" },
  { container: "bg-tertiary-container", shape: "fill-tertiary/15", text: "text-on-tertiary-container", shapeName: "sunny" },
];

function hash(value: string) {
  let result = 0;
  for (let i = 0; i < value.length; i++) result = (result * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(result);
}

type BookCoverProps = {
  title: string;
  coverUrl: string | null;
  className?: string;
  /** Pixel width of the placeholder shape. */
  size?: "sm" | "md" | "lg";
};

/** The cover image, or a colorful placeholder with the title when there's no image. */
export function BookCover({ title, coverUrl, className, size = "md" }: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const shapeSize = size === "sm" ? 48 : size === "md" ? 120 : 200;

  if (coverUrl && !failed) {
    return (
      // Covers come from Open Library or Google Books, so they use a plain <img> without image optimization.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={coverUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cx("aspect-[2/3] w-full rounded-md bg-surface-container-highest object-cover", className)}
      />
    );
  }

  const style = PLACEHOLDERS[hash(title) % PLACEHOLDERS.length];
  return (
    <div
      aria-hidden="true"
      className={cx("relative grid aspect-[2/3] w-full place-items-center overflow-hidden rounded-md", style.container, className)}
    >
      <span className="absolute -right-1/4 -bottom-1/6 opacity-100">
        <Shape shape={style.shapeName} size={shapeSize} className={style.shape} />
      </span>
      <span
        className={cx(
          "relative line-clamp-4 px-2 text-center",
          size === "sm" ? "text-label-sm-em" : size === "md" ? "text-title-sm-em" : "text-headline-sm-em",
          style.text,
        )}
        style={{ fontVariationSettings: '"ROND" 100' }}
      >
        {size === "sm" ? title.slice(0, 1).toUpperCase() : title}
      </span>
    </div>
  );
}
