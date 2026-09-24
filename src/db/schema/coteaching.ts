import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { classes } from "./roster";

/**
 * A teacher working in one of another teacher's classes.
 *
 * With `shelf_loans`, one of only two tables holding two teacher IDs. The class is reached
 * through the owner's composite `(id, teacher_id)` key, so a row naming one teacher as the
 * owner of another teacher's class is rejected by the database. Nothing here moves data:
 * everything a co-teacher adds or changes is still stored under the owner.
 */
export const classTeachers = pgTable(
  "class_teachers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id").notNull(),
    ownerTeacherId: text("owner_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    coTeacherId: text("co_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "class_teachers_class_fk",
      columns: [t.classId, t.ownerTeacherId],
      foreignColumns: [classes.id, classes.teacherId],
    }).onDelete("cascade"),
    unique("class_teachers_one_per_class").on(t.classId, t.coTeacherId),
    index("class_teachers_co_idx").on(t.coTeacherId, t.ownerTeacherId),
    check("class_teachers_not_self", sql`${t.ownerTeacherId} <> ${t.coTeacherId}`),
  ],
);

/**
 * A co-teacher invited by an email that has no account yet. It turns into a
 * `class_teachers` row the first time someone signs in with that email *verified*
 * (Google, or an account an admin created): a password sign-up can't claim it, because
 * an unverified address could be anyone's and the grant shows student names.
 */
export const classTeacherInvites = pgTable(
  "class_teacher_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id").notNull(),
    ownerTeacherId: text("owner_teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "class_teacher_invites_class_fk",
      columns: [t.classId, t.ownerTeacherId],
      foreignColumns: [classes.id, classes.teacherId],
    }).onDelete("cascade"),
    unique("class_teacher_invites_one_per_class").on(t.classId, t.email),
    index("class_teacher_invites_email_idx").on(t.email),
    check("class_teacher_invites_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);
