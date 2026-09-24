import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { handoverStatuses, sqlList } from "./enums";

/**
 * An offer to hand classes and books to another teacher. Nothing moves until the
 * recipient accepts, and everything is checked again at that moment.
 *
 * The ids are what was offered, resolved when it was sent: "all my books" means the books
 * the recipient was told about, not whatever the library holds by the time they accept.
 * Anything deleted in between is simply skipped. No foreign keys on the arrays, so the
 * record survives the rows it names.
 */
export const handovers = pgTable(
  "handovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromTeacherId: text("from_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toTeacherId: text("to_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    classIds: uuid("class_ids").array().notNull().default(sql`'{}'::uuid[]`),
    bookIds: uuid("book_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: text("status", { enum: handoverStatuses }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    // One offer at a time from each teacher, so two can't claim the same books.
    uniqueIndex("handovers_one_pending_per_sender").on(t.fromTeacherId).where(sql`${t.status} = 'pending'`),
    index("handovers_to_idx").on(t.toTeacherId, t.status),
    check("handovers_distinct_teachers", sql`${t.fromTeacherId} <> ${t.toTeacherId}`),
    check("handovers_status_check", sql.raw(`status in ${sqlList(handoverStatuses)}`)),
    check("handovers_not_empty", sql`cardinality(${t.classIds}) + cardinality(${t.bookIds}) > 0`),
  ],
);
