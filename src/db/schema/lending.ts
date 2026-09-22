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
import { connectionStatuses, shelfLoanStatuses, sqlList } from "./enums";

/**
 * Two teachers who have agreed to share shelves. The pair is stored normalized
 * (`teacher_a_id` < `teacher_b_id`) so one pair can only ever have one row, whichever
 * of the two asked first. `requested_by_id` remembers who asked, since the other one
 * is the only one who may accept.
 */
export const teacherConnections = pgTable(
  "teacher_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherAId: text("teacher_a_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teacherBId: text("teacher_b_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: connectionStatuses }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("teacher_connections_pair_unique").on(t.teacherAId, t.teacherBId),
    index("teacher_connections_b_idx").on(t.teacherBId, t.status),
    check("teacher_connections_ordered", sql`${t.teacherAId} < ${t.teacherBId}`),
    check(
      "teacher_connections_requester_member",
      sql`${t.requestedById} in (${t.teacherAId}, ${t.teacherBId})`,
    ),
    check("teacher_connections_status_check", sql.raw(`status in ${sqlList(connectionStatuses)}`)),
    check(
      "teacher_connections_response_consistency",
      sql`(${t.status} = 'pending') = (${t.respondedAt} is null)`,
    ),
  ],
);

/**
 * One book travelling from its owner's room to a connected teacher's room.
 *
 * This is the only table where two teacher IDs meet, and it still reaches each library
 * through a composite `(id, teacher_id)` foreign key, so a row can never quietly pair
 * one teacher's copy with another teacher's shelf.
 *
 * The borrower asks for a title; a specific `copy_id` is chosen when the owner approves.
 * `borrower_copy_id` is the stand-in copy created on the borrower's shelf for the length
 * of the loan, which is what their students actually check out.
 */
export const shelfLoans = pgTable(
  "shelf_loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerTeacherId: text("owner_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    borrowerTeacherId: text("borrower_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull(),
    copyId: uuid("copy_id"),
    borrowerCopyId: uuid("borrower_copy_id"),
    status: text("status", { enum: shelfLoanStatuses }).notNull().default("requested"),
    /** A note from the borrower with the request. */
    message: text("message"),
    /** Calendar date the borrower agreed to return it by. Null means open-ended. */
    dueOn: date("due_on", { mode: "string" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "shelf_loans_book_fk",
      columns: [t.bookId, t.ownerTeacherId],
      foreignColumns: [books.id, books.teacherId],
    }).onDelete("cascade"),
    foreignKey({
      name: "shelf_loans_copy_fk",
      columns: [t.copyId, t.ownerTeacherId],
      foreignColumns: [copies.id, copies.teacherId],
    }).onDelete("cascade"),
    foreignKey({
      name: "shelf_loans_borrower_copy_fk",
      columns: [t.borrowerCopyId, t.borrowerTeacherId],
      foreignColumns: [copies.id, copies.teacherId],
    }).onDelete("cascade"),
    // One pending ask per title, so a borrower can't queue the same book twice.
    uniqueIndex("shelf_loans_one_request_per_title")
      .on(t.bookId, t.borrowerTeacherId)
      .where(sql`${t.status} = 'requested'`),
    // A copy can only be out on one shelf loan at a time.
    uniqueIndex("shelf_loans_one_active_per_copy")
      .on(t.copyId)
      .where(sql`${t.status} = 'active'`),
    index("shelf_loans_owner_idx").on(t.ownerTeacherId, t.status),
    index("shelf_loans_borrower_idx").on(t.borrowerTeacherId, t.status),
    check("shelf_loans_status_check", sql.raw(`status in ${sqlList(shelfLoanStatuses)}`)),
    check("shelf_loans_distinct_teachers", sql`${t.ownerTeacherId} <> ${t.borrowerTeacherId}`),
    check(
      "shelf_loans_active_has_copies",
      sql`${t.status} <> 'active' or (${t.copyId} is not null and ${t.borrowerCopyId} is not null)`,
    ),
    check(
      "shelf_loans_returned_at_consistency",
      sql`(${t.status} = 'returned') = (${t.returnedAt} is not null)`,
    ),
  ],
);
