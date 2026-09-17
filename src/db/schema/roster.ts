import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Display label such as "2026–27". */
    schoolYear: text("school_year").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Target for composite foreign keys that keep rows inside one teacher's data.
    unique("classes_id_teacher_unique").on(t.id, t.teacherId),
    index("classes_teacher_idx").on(t.teacherId),
  ],
);

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    classId: uuid("class_id"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    studentNumber: text("student_number"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("students_id_teacher_unique").on(t.id, t.teacherId),
    foreignKey({
      name: "students_class_fk",
      columns: [t.classId, t.teacherId],
      foreignColumns: [classes.id, classes.teacherId],
    }),
    index("students_teacher_class_idx").on(t.teacherId, t.classId),
    uniqueIndex("students_teacher_number_unique")
      .on(t.teacherId, t.studentNumber)
      .where(sql`${t.studentNumber} is not null`),
  ],
);
