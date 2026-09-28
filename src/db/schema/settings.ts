import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { genres } from "./catalog";
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
    /** Whether the starter genres have been given, so a teacher who deletes them all keeps none. */
    genresSeeded: boolean("genres_seeded").notNull().default(false),
    /**
     * The genre every book added from now on is given, until changed: a teacher catalogues
     * one genre shelf at a time. Kept here rather than in the browser so a paired phone,
     * which adds on the server, uses it too.
     */
    addingGenreId: uuid("adding_genre_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // ON DELETE SET NULL ("adding_genre_id") is written into the migration by hand, as for
    // books_genre_fk: a plain SET NULL would null teacher_id, the primary key, too.
    foreignKey({
      name: "teacher_settings_adding_genre_fk",
      columns: [t.addingGenreId, t.teacherId],
      foreignColumns: [genres.id, genres.teacherId],
    }).onDelete("set null"),
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
