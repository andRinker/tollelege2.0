import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminActions, sqlList } from "./enums";

/**
 * Every time an admin looks inside a teacher's account or acts on it.
 *
 * The one table that isn't teacher data, so it has no `teacher_id` and no foreign keys:
 * a record of deleting an account has to outlive the account, and one of an admin's
 * actions has to outlive that admin. Names and emails are copied in for the same reason.
 */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: text("admin_id").notNull(),
    adminEmail: text("admin_email").notNull(),
    action: text("action", { enum: adminActions }).notNull(),
    targetTeacherId: text("target_teacher_id").notNull(),
    targetEmail: text("target_email").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_at_idx").on(t.at),
    index("admin_audit_target_idx").on(t.targetTeacherId, t.at),
    check("admin_audit_action_check", sql.raw(`action in ${sqlList(adminActions)}`)),
  ],
);
