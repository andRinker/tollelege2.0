"use client";

import { Label, Radio, RadioGroup } from "react-aria-components";
import { type GenreColor, genreColors } from "@/db/schema/enums";
import { GENRE_COLORS } from "@/lib/genre-colors";
import { cx } from "@/ui/cx";
import { ListBoxItem } from "@/ui/components/menu";
import { Select } from "@/ui/components/select";

export type GenreOption = { id: string; name: string; color: GenreColor };

/**
 * The coloured dot a genre wears, like the sticker on the spine. Decorative on its own: say the
 * genre's name beside it, or give it a `label` where it stands alone.
 */
export function GenreDot({ color, label, className }: { color: GenreColor; label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-block size-3 shrink-0 rounded-full ring-1 ring-on-surface/15", className)}
      style={{ backgroundColor: GENRE_COLORS[color].hex }}
    />
  );
}

/** A genre as it's named in a row: its dot and its name. */
export function GenreLabel({ genre, className }: { genre: { name: string; color: GenreColor }; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5", className)}>
      <GenreDot color={genre.color} />
      <span className="truncate">{genre.name}</span>
    </span>
  );
}

const NONE = "none";

/** Picks one of the teacher's genres, or none. */
export function GenreSelect({
  genres,
  value,
  onChange,
  label = "Genre",
  className,
}: {
  genres: GenreOption[];
  value: string | null;
  onChange: (genreId: string | null) => void;
  label?: string;
  className?: string;
}) {
  const items = [{ id: NONE, name: "No genre", color: null }, ...genres];
  return (
    <Select
      label={label}
      items={items}
      selectedKey={value ?? NONE}
      onSelectionChange={(key) => onChange(key === NONE || key == null ? null : String(key))}
      className={className}
    >
      {(item: { id: string; name: string; color: GenreColor | null }) => (
        <ListBoxItem id={item.id} textValue={item.name}>
          <span className="flex items-center gap-2">
            {item.color ? <GenreDot color={item.color} /> : <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-outline" />}
            {item.name}
          </span>
        </ListBoxItem>
      )}
    </Select>
  );
}

/** Picks a genre's colour from the fixed palette, as a row of swatches. */
export function ColorSwatches({
  value,
  onChange,
  label = "Colour",
}: {
  value: GenreColor;
  onChange: (color: GenreColor) => void;
  label?: string;
}) {
  return (
    <RadioGroup value={value} onChange={(next) => onChange(next as GenreColor)} orientation="horizontal" className="flex flex-col gap-2">
      <Label className="text-label-lg text-on-surface-variant">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {genreColors.map((color) => (
          <Radio
            key={color}
            value={color}
            aria-label={GENRE_COLORS[color].label}
            className="group grid size-11 cursor-pointer place-items-center rounded-full outline-none"
          >
            <span
              className="size-8 rounded-full ring-1 ring-on-surface/15 transition-shadow group-data-[focus-visible]:outline-3 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-secondary group-data-[selected]:ring-3 group-data-[selected]:ring-on-surface group-data-[selected]:ring-offset-2 group-data-[selected]:ring-offset-surface"
              style={{ backgroundColor: GENRE_COLORS[color].hex }}
            />
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
