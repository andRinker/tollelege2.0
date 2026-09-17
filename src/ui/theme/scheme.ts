import {
  argbFromHex,
  type DynamicColor,
  type DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
} from "@material/material-color-utilities";
import type { ThemeContrast } from "@/db/schema/enums";

const colors = new MaterialDynamicColors();

/** Every Material color role, keyed by its CSS name (`--md-sys-color-<role>`). */
const ROLES: Record<string, DynamicColor> = {
  primary: colors.primary(),
  "on-primary": colors.onPrimary(),
  "primary-container": colors.primaryContainer(),
  "on-primary-container": colors.onPrimaryContainer(),
  "inverse-primary": colors.inversePrimary(),
  "primary-fixed": colors.primaryFixed(),
  "primary-fixed-dim": colors.primaryFixedDim(),
  "on-primary-fixed": colors.onPrimaryFixed(),
  "on-primary-fixed-variant": colors.onPrimaryFixedVariant(),
  secondary: colors.secondary(),
  "on-secondary": colors.onSecondary(),
  "secondary-container": colors.secondaryContainer(),
  "on-secondary-container": colors.onSecondaryContainer(),
  "secondary-fixed": colors.secondaryFixed(),
  "secondary-fixed-dim": colors.secondaryFixedDim(),
  "on-secondary-fixed": colors.onSecondaryFixed(),
  "on-secondary-fixed-variant": colors.onSecondaryFixedVariant(),
  tertiary: colors.tertiary(),
  "on-tertiary": colors.onTertiary(),
  "tertiary-container": colors.tertiaryContainer(),
  "on-tertiary-container": colors.onTertiaryContainer(),
  "tertiary-fixed": colors.tertiaryFixed(),
  "tertiary-fixed-dim": colors.tertiaryFixedDim(),
  "on-tertiary-fixed": colors.onTertiaryFixed(),
  "on-tertiary-fixed-variant": colors.onTertiaryFixedVariant(),
  error: colors.error(),
  "on-error": colors.onError(),
  "error-container": colors.errorContainer(),
  "on-error-container": colors.onErrorContainer(),
  background: colors.background(),
  "on-background": colors.onBackground(),
  surface: colors.surface(),
  "on-surface": colors.onSurface(),
  "surface-variant": colors.surfaceVariant(),
  "on-surface-variant": colors.onSurfaceVariant(),
  "surface-dim": colors.surfaceDim(),
  "surface-bright": colors.surfaceBright(),
  "surface-container-lowest": colors.surfaceContainerLowest(),
  "surface-container-low": colors.surfaceContainerLow(),
  "surface-container": colors.surfaceContainer(),
  "surface-container-high": colors.surfaceContainerHigh(),
  "surface-container-highest": colors.surfaceContainerHighest(),
  "inverse-surface": colors.inverseSurface(),
  "inverse-on-surface": colors.inverseOnSurface(),
  outline: colors.outline(),
  "outline-variant": colors.outlineVariant(),
  shadow: colors.shadow(),
  scrim: colors.scrim(),
  "surface-tint": colors.surfaceTint(),
};

export const COLOR_ROLE_NAMES = Object.keys(ROLES);

const CONTRAST_LEVELS: Record<ThemeContrast, number> = { standard: 0, medium: 0.5, high: 1 };

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Builds a scheme with the Material 3 Expressive (2025) color spec. */
export function createScheme(seed: string, isDark: boolean, contrast: ThemeContrast): DynamicScheme {
  return new SchemeTonalSpot(
    Hct.fromInt(argbFromHex(seed)),
    isDark,
    CONTRAST_LEVELS[contrast],
    "2025",
  );
}

export function schemeColors(scheme: DynamicScheme): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ROLES).map(([name, color]) => [name, hexFromArgb(color.getArgb(scheme))]),
  );
}

function declarations(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, hex]) => `--md-sys-color-${name}:${hex};`)
    .join("");
}

const cssCache = new Map<string, string>();

/**
 * CSS for the whole page. `<html data-theme-mode>` chooses light, dark, or the
 * system preference; the dark values are included for all three.
 */
export function themeCss(seed: string, contrast: ThemeContrast): string {
  const safeSeed = isHexColor(seed) ? seed.toLowerCase() : "#2e7d5b";
  const key = `${safeSeed}|${contrast}`;
  const cached = cssCache.get(key);
  if (cached) return cached;

  const light = declarations(schemeColors(createScheme(safeSeed, false, contrast)));
  const dark = declarations(schemeColors(createScheme(safeSeed, true, contrast)));
  const css =
    `:root{color-scheme:light;${light}}` +
    `:root[data-theme-mode="dark"]{color-scheme:dark;${dark}}` +
    `@media (prefers-color-scheme: dark){:root[data-theme-mode="system"]{color-scheme:dark;${dark}}}`;

  cssCache.set(key, css);
  return css;
}
