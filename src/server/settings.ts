import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  type ReadingLevelSystem,
  teacherSettings,
  type ThemeContrast,
  type ThemeMode,
} from "@/db/schema";

export type TeacherSettings = {
  loanPeriodDays: number | null;
  maxBooksPerStudent: number | null;
  readingLevelSystem: ReadingLevelSystem;
  timeZone: string | null;
  themeSeedColor: string | null;
  themeMode: ThemeMode;
  themeContrast: ThemeContrast;
};

export const DEFAULT_TEACHER_SETTINGS: TeacherSettings = {
  loanPeriodDays: 14,
  maxBooksPerStudent: null,
  readingLevelSystem: "none",
  timeZone: null,
  themeSeedColor: null,
  themeMode: "system",
  themeContrast: "standard",
};

export async function getTeacherSettings(db: Database, teacherId: string): Promise<TeacherSettings> {
  const [row] = await db
    .select({
      loanPeriodDays: teacherSettings.loanPeriodDays,
      maxBooksPerStudent: teacherSettings.maxBooksPerStudent,
      readingLevelSystem: teacherSettings.readingLevelSystem,
      timeZone: teacherSettings.timeZone,
      themeSeedColor: teacherSettings.themeSeedColor,
      themeMode: teacherSettings.themeMode,
      themeContrast: teacherSettings.themeContrast,
    })
    .from(teacherSettings)
    .where(eq(teacherSettings.teacherId, teacherId))
    .limit(1);
  return row ?? DEFAULT_TEACHER_SETTINGS;
}

export async function updateTeacherSettings(
  db: Database,
  teacherId: string,
  patch: Partial<TeacherSettings>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .insert(teacherSettings)
    .values({ teacherId, ...patch })
    .onConflictDoUpdate({
      target: teacherSettings.teacherId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Saves the browser's time zone the first time it's seen. Never overwrites a saved zone. */
export async function rememberTimeZone(db: Database, teacherId: string, timeZone: string): Promise<void> {
  if (!isValidTimeZone(timeZone)) return;
  await db
    .insert(teacherSettings)
    .values({ teacherId, timeZone })
    .onConflictDoUpdate({
      target: teacherSettings.teacherId,
      set: { timeZone, updatedAt: new Date() },
      setWhere: sql`${teacherSettings.timeZone} is null`,
    });
}
