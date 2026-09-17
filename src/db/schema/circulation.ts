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
import { copies } from "./catalog";
import { closeReasons, sqlList } from "./enums";
import { students } from "./roster";

export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    copyId: uuid("copy_id").notNull(),
    studentId: uuid("student_id").notNull(),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }).notNull().defaultNow(),
    /** Calendar date in the teacher's time zone. Null means no due date. */
    dueOn: date("due_on", { mode: "string" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason", { enum: closeReasons }),
  },
  (t) => [
    // Composite keys make it impossible to link one teacher's copy or student to another's.
    foreignKey({
      name: "loans_copy_fk",
      columns: [t.copyId, t.teacherId],
      foreignColumns: [copies.id, copies.teacherId],
    }),
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
    check("loans_close_consistency", sql`(${t.closedAt} is null) = (${t.closeReason} is null)`),
    check(
      "loans_close_reason_check",
      sql.raw(`close_reason is null or close_reason in ${sqlList(closeReasons)}`),
    ),
  ],
);
