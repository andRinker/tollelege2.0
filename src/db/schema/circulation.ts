import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { books, copies } from "./catalog";
import { closeReasons, sqlList } from "./enums";
import { students } from "./roster";

export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null once the copy has been deleted. The checkout outlives it — see `bookTitle`. */
    copyId: uuid("copy_id"),
    /** Null once the book has been deleted. Kept apart from `copyId` so a deleted copy's
     * checkouts still show on the book's own page. */
    bookId: uuid("book_id"),
    /**
     * What the book was called when it went out. A student's reading history belongs to
     * the student, not to the catalogue, so deleting a book must not erase it: while the
     * book exists its current title is shown, and after that this one.
     */
    bookTitle: text("book_title").notNull(),
    bookAuthors: text("book_authors").array().notNull().default(sql`'{}'::text[]`),
    studentId: uuid("student_id").notNull(),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }).notNull().defaultNow(),
    /** Calendar date in the teacher's time zone. Null means no due date. */
    dueOn: date("due_on", { mode: "string" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason", { enum: closeReasons }),
  },
  (t) => [
    // Composite keys make it impossible to link one teacher's copy or student to another's.
    // Deleting a copy or book clears the link and keeps the checkout. The migration writes
    // these as `ON DELETE SET NULL (copy_id)` / `(book_id)`: a plain SET NULL would also null
    // `teacher_id`, which can't be null, and every delete would fail. drizzle can't express
    // the column list, so if these keys are ever regenerated, carry that clause across.
    foreignKey({
      name: "loans_copy_fk",
      columns: [t.copyId, t.teacherId],
      foreignColumns: [copies.id, copies.teacherId],
    }).onDelete("set null"),
    foreignKey({
      name: "loans_book_fk",
      columns: [t.bookId, t.teacherId],
      foreignColumns: [books.id, books.teacherId],
    }).onDelete("set null"),
    foreignKey({
      name: "loans_student_fk",
      columns: [t.studentId, t.teacherId],
      foreignColumns: [students.id, students.teacherId],
    }),
    // A copy can only be checked out once at a time, even under concurrent requests.
    uniqueIndex("loans_one_open_per_copy").on(t.copyId).where(sql`${t.closedAt} is null`),
    index("loans_teacher_closed_idx").on(t.teacherId, t.closedAt),
    index("loans_student_closed_idx").on(t.studentId, t.closedAt),
    index("loans_copy_idx").on(t.copyId),
    index("loans_book_idx").on(t.bookId),
    // Only a finished checkout can lose its copy: an open one is a book in a student's hands.
    check("loans_open_has_copy", sql`${t.closedAt} is not null or ${t.copyId} is not null`),
    check("loans_close_consistency", sql`(${t.closedAt} is null) = (${t.closeReason} is null)`),
    check(
      "loans_close_reason_check",
      sql.raw(`close_reason is null or close_reason in ${sqlList(closeReasons)}`),
    ),
  ],
);
