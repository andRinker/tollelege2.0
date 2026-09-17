import type { ThemeContrast, ThemeMode } from "@/db/schema/enums";

export const DEFAULT_THEME_SEED = "#2E7D5B";

export const THEME_SWATCHES = [
  { name: "Evergreen", seed: "#2E7D5B" },
  { name: "Ocean", seed: "#1F6FB2" },
  { name: "Grape", seed: "#6750A4" },
  { name: "Berry", seed: "#B3265E" },
  { name: "Sunset", seed: "#D0532A" },
  { name: "Marigold", seed: "#C9A227" },
  { name: "Teal", seed: "#00897B" },
  { name: "Slate", seed: "#5B6B7A" },
] as const;

export type ThemePreferences = {
  seed: string;
  mode: ThemeMode;
  contrast: ThemeContrast;
};

export const DEFAULT_THEME: ThemePreferences = {
  seed: DEFAULT_THEME_SEED,
  mode: "system",
  contrast: "standard",
};
