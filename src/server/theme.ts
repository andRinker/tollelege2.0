import "server-only";
import { cache } from "react";
import { getDb } from "@/db/client";
import { getSession } from "@/server/session";
import { DEFAULT_TEACHER_SETTINGS, getTeacherSettings, type TeacherSettings } from "@/server/settings";
import { DEFAULT_THEME, type ThemePreferences } from "@/ui/theme/constants";

/** The signed-in teacher's settings for this request (defaults when signed out). */
export const getRequestSettings = cache(async (): Promise<TeacherSettings> => {
  const session = await getSession();
  if (!session) return DEFAULT_TEACHER_SETTINGS;
  return getTeacherSettings(getDb(), session.user.id);
});

export function themeFromSettings(settings: TeacherSettings): ThemePreferences {
  return {
    seed: settings.themeSeedColor ?? DEFAULT_THEME.seed,
    mode: settings.themeMode,
    contrast: settings.themeContrast,
  };
}

/** The signed-in teacher's theme, or the default theme for signed-out pages. */
export async function getThemeForRequest(): Promise<ThemePreferences> {
  return themeFromSettings(await getRequestSettings());
}
