import type { ThemePreferences } from "./constants";
import { themeCss } from "./scheme";

/** Applies a theme immediately in the browser, before the server re-renders with it. */
export function previewTheme(theme: ThemePreferences) {
  const style = document.getElementById("md-theme");
  if (style) style.textContent = themeCss(theme.seed, theme.contrast);
  document.documentElement.dataset.themeMode = theme.mode;
}
