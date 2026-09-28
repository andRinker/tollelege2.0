import type { GenreColor } from "@/db/schema/enums";

/**
 * The dot each genre colour draws. Fixed hues, deliberately outside the theme tokens: a dot in
 * the app has to match the round sticker on the book's spine, whatever the theme. The names are
 * what a teacher picks from, so they say the colour of the sticker, not its use.
 */
export const GENRE_COLORS: Record<GenreColor, { label: string; hex: string }> = {
  green: { label: "Green", hex: "#3fb74a" },
  blue: { label: "Blue", hex: "#2a7fd4" },
  orange: { label: "Orange", hex: "#f28c28" },
  red: { label: "Red", hex: "#e2462c" },
  pink: { label: "Pink", hex: "#e0245e" },
  yellow: { label: "Yellow", hex: "#f5c518" },
  purple: { label: "Purple", hex: "#8e4fbf" },
  teal: { label: "Teal", hex: "#15a39a" },
  brown: { label: "Brown", hex: "#8b5e34" },
  grey: { label: "Grey", hex: "#8a9096" },
};
