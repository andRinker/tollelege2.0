import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { copyStatuses, metadataSources, sqlList } from "./enums";

/** A title in a teacher's library. Physical items are rows in `copies`. */
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    isbn13: text("isbn13"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
    description: text("description"),
    coverUrl: text("cover_url"),
    publisher: text("publisher"),
    publishedYear: integer("published_year"),
    pageCount: integer("page_count"),
    readingLevel: text("reading_level"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Bin or shelf label. */
    location: text("location"),
    notes: text("notes"),
    /** Offered to connected teachers. On by default; turn it off for class sets. */
    lendable: boolean("lendable").notNull().default(true),
    metadataSource: text("metadata_source", { enum: metadataSources })
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("books_id_teacher_unique").on(t.id, t.teacherId),
    uniqueIndex("books_teacher_isbn_unique")
      .on(t.teacherId, t.isbn13)
      .where(sql`${t.isbn13} is not null`),
    index("books_teacher_title_idx").on(t.teacherId, t.title),
    check("books_isbn13_format", sql`${t.isbn13} is null or ${t.isbn13} ~ '^97[89][0-9]{10}$'`),
    check(
      "books_metadata_source_check",
      sql.raw(`metadata_source in ${sqlList(metadataSources)}`),
    ),
  ],
);

export const copies = pgTable(
  "copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull(),
    copyNumber: integer("copy_number").notNull(),
    status: text("status", { enum: copyStatuses }).notNull().default("in_circulation"),
    conditionNote: text("condition_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("copies_id_teacher_unique").on(t.id, t.teacherId),
    unique("copies_book_number_unique").on(t.bookId, t.copyNumber),
    foreignKey({
      name: "copies_book_fk",
      columns: [t.bookId, t.teacherId],
      foreignColumns: [books.id, books.teacherId],
    }).onDelete("cascade"),
    index("copies_teacher_book_idx").on(t.teacherId, t.bookId),
    check("copies_status_check", sql.raw(`status in ${sqlList(copyStatuses)}`)),
    check("copies_copy_number_positive", sql`${t.copyNumber} > 0`),
  ],
);
