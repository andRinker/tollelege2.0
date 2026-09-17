import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import {
  readingLevelSystems,
  sqlList,
  themeContrasts,
  themeModes,
} from "./enums";

export const teacherSettings = pgTable(
  "teacher_settings",
  {
    teacherId: text("teacher_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null means books are checked out without due dates. */
    loanPeriodDays: integer("loan_period_days").default(14),
    /** Null means no limit. */
    maxBooksPerStudent: integer("max_books_per_student"),
    readingLevelSystem: text("reading_level_system", { enum: readingLevelSystems })
      .notNull()
      .default("none"),
    /** IANA time zone used to decide what "today" is for due dates. */
    timeZone: text("time_zone"),
    /** Hex seed color for the Material theme. Null uses the app default. */
    themeSeedColor: text("theme_seed_color"),
    themeMode: text("theme_mode", { enum: themeModes }).notNull().default("system"),
    themeContrast: text("theme_contrast", { enum: themeContrasts })
      .notNull()
      .default("standard"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "teacher_settings_loan_period_range",
      sql`${t.loanPeriodDays} is null or ${t.loanPeriodDays} between 1 and 365`,
    ),
    check(
      "teacher_settings_max_books_range",
      sql`${t.maxBooksPerStudent} is null or ${t.maxBooksPerStudent} between 1 and 50`,
    ),
    check(
      "teacher_settings_reading_level_system_check",
      sql.raw(`reading_level_system in ${sqlList(readingLevelSystems)}`),
    ),
    check("teacher_settings_theme_mode_check", sql.raw(`theme_mode in ${sqlList(themeModes)}`)),
    check(
      "teacher_settings_theme_contrast_check",
      sql.raw(`theme_contrast in ${sqlList(themeContrasts)}`),
    ),
    check(
      "teacher_settings_theme_seed_color_format",
      sql`${t.themeSeedColor} is null or ${t.themeSeedColor} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
  ],
);
