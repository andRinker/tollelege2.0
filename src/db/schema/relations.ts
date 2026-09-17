import { relations } from "drizzle-orm";
import { user } from "./auth";
import { books, copies } from "./catalog";
import { loans } from "./circulation";
import { classes, students } from "./roster";
import { teacherSettings } from "./settings";

export const teacherSettingsRelations = relations(teacherSettings, ({ one }) => ({
  teacher: one(user, { fields: [teacherSettings.teacherId], references: [user.id] }),
}));

export const classesRelations = relations(classes, ({ many }) => ({
  students: many(students),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  class: one(classes, { fields: [students.classId], references: [classes.id] }),
  loans: many(loans),
}));

export const booksRelations = relations(books, ({ many }) => ({
  copies: many(copies),
}));

export const copiesRelations = relations(copies, ({ one, many }) => ({
  book: one(books, { fields: [copies.bookId], references: [books.id] }),
  loans: many(loans),
}));

export const loansRelations = relations(loans, ({ one }) => ({
  copy: one(copies, { fields: [loans.copyId], references: [copies.id] }),
  student: one(students, { fields: [loans.studentId], references: [students.id] }),
}));
