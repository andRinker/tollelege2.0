import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, classes, copies, loans, students } from "@/db/schema";
import type { ParsedStudent } from "@/lib/roster-parse";
import { ConflictError, isUniqueViolation, NotFoundError } from "./errors";

export type ClassInput = { name: string; schoolYear: string };
export type StudentInput = { firstName: string; lastName: string; studentNumber: string | null };

const studentSortOrder = [asc(sql`lower(${students.lastName})`), asc(sql`lower(${students.firstName})`)];

/** Open loans per student, and how many of those are past due on `today` (YYYY-MM-DD). */
function loanCounts(today: string) {
  return {
    booksOut: sql<number>`count(${loans.id})`.mapWith(Number),
    overdue: sql<number>`count(${loans.id}) filter (where ${loans.dueOn} < ${today})`.mapWith(Number),
  };
}

async function requireClass(db: Database, teacherId: string, classId: string) {
  const [klass] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId)));
  if (!klass) throw new NotFoundError("That class isn't in your account.");
  return klass;
}

export async function createClass(db: Database, teacherId: string, input: ClassInput) {
  const [klass] = await db.insert(classes).values({ teacherId, ...input }).returning();
  return klass;
}

export async function updateClass(db: Database, teacherId: string, classId: string, input: Partial<ClassInput>) {
  const updated = await db
    .update(classes)
    .set(input)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId)))
    .returning({ id: classes.id });
  if (updated.length === 0) throw new NotFoundError("That class isn't in your account.");
}

export async function setClassArchived(db: Database, teacherId: string, classId: string, archived: boolean) {
  const updated = await db
    .update(classes)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId)))
    .returning({ id: classes.id });
  if (updated.length === 0) throw new NotFoundError("That class isn't in your account.");
}

export async function deleteClass(db: Database, teacherId: string, classId: string) {
  await db.transaction(async (tx) => {
    await requireClass(tx, teacherId, classId);
    const [{ studentCount }] = await tx.select({ studentCount: count() }).from(students).where(eq(students.classId, classId));
    if (studentCount > 0) {
      throw new ConflictError("This class still has students. Move or remove them first, or archive the class instead.");
    }
    await tx.delete(classes).where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId)));
  });
}

export type ClassSummary = {
  id: string;
  name: string;
  schoolYear: string;
  archivedAt: Date | null;
  studentCount: number;
  booksOut: number;
  overdue: number;
};

export async function listClasses(db: Database, teacherId: string, today: string): Promise<ClassSummary[]> {
  const studentCounts = db
    .select({
      classId: students.classId,
      studentCount: sql<number>`count(*) filter (where ${students.active})`.mapWith(Number).as("student_count"),
    })
    .from(students)
    .where(eq(students.teacherId, teacherId))
    .groupBy(students.classId)
    .as("student_counts");

  const openLoans = db
    .select({
      classId: students.classId,
      booksOut: loanCounts(today).booksOut.as("books_out"),
      overdue: loanCounts(today).overdue.as("overdue"),
    })
    .from(loans)
    .innerJoin(students, eq(students.id, loans.studentId))
    .where(and(eq(loans.teacherId, teacherId), isNull(loans.closedAt)))
    .groupBy(students.classId)
    .as("open_loans");

  const rows = await db
    .select({
      id: classes.id,
      name: classes.name,
      schoolYear: classes.schoolYear,
      archivedAt: classes.archivedAt,
      studentCount: sql<number>`coalesce(${studentCounts.studentCount}, 0)`.mapWith(Number),
      booksOut: sql<number>`coalesce(${openLoans.booksOut}, 0)`.mapWith(Number),
      overdue: sql<number>`coalesce(${openLoans.overdue}, 0)`.mapWith(Number),
    })
    .from(classes)
    .leftJoin(studentCounts, eq(studentCounts.classId, classes.id))
    .leftJoin(openLoans, eq(openLoans.classId, classes.id))
    .where(eq(classes.teacherId, teacherId))
    .orderBy(desc(classes.schoolYear), asc(sql`lower(${classes.name})`));
  return rows;
}

/** Active students and classes that aren't archived. */
export async function rosterCounts(db: Database, teacherId: string) {
  const [[studentTotals], [classTotals]] = await Promise.all([
    db
      .select({ count: count() })
      .from(students)
      .where(and(eq(students.teacherId, teacherId), eq(students.active, true))),
    db
      .select({ count: count() })
      .from(classes)
      .where(and(eq(classes.teacherId, teacherId), isNull(classes.archivedAt))),
  ]);
  return { students: studentTotals.count, classes: classTotals.count };
}

export type RosterStudent = {
  id: string;
  firstName: string;
  lastName: string;
  studentNumber: string | null;
  active: boolean;
  booksOut: number;
  overdue: number;
};

export async function getClassRoster(db: Database, teacherId: string, classId: string, today: string) {
  const klass = await requireClass(db, teacherId, classId);
  const roster = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      studentNumber: students.studentNumber,
      active: students.active,
      ...loanCounts(today),
    })
    .from(students)
    .leftJoin(loans, and(eq(loans.studentId, students.id), isNull(loans.closedAt)))
    .where(and(eq(students.classId, classId), eq(students.teacherId, teacherId)))
    .groupBy(students.id)
    .orderBy(...studentSortOrder);
  return { class: klass, students: roster as RosterStudent[] };
}

function mapStudentError(error: unknown): never {
  if (isUniqueViolation(error, "students_teacher_number_unique")) {
    throw new ConflictError("Another student in your account already has that student ID.");
  }
  if ((error as { cause?: { code?: string } })?.cause?.code === "23503") {
    throw new NotFoundError("That class isn't in your account.");
  }
  throw error;
}

export async function addStudent(db: Database, teacherId: string, classId: string | null, input: StudentInput) {
  try {
    const [student] = await db
      .insert(students)
      .values({ teacherId, classId, ...input })
      .returning();
    return student;
  } catch (error) {
    mapStudentError(error);
  }
}

/** Adds students to a class, skipping anyone already on its roster or whose ID is taken. */
export async function importStudents(db: Database, teacherId: string, classId: string, incoming: ParsedStudent[]) {
  return db.transaction(async (tx) => {
    await requireClass(tx, teacherId, classId);
    const existing = await tx
      .select({ firstName: students.firstName, lastName: students.lastName, studentNumber: students.studentNumber, classId: students.classId })
      .from(students)
      .where(eq(students.teacherId, teacherId));

    const namesInClass = new Set(
      existing
        .filter((student) => student.classId === classId)
        .map((student) => `${student.firstName}|${student.lastName}`.toLowerCase()),
    );
    const takenNumbers = new Set(existing.map((student) => student.studentNumber).filter(Boolean));

    const toInsert: ParsedStudent[] = [];
    for (const student of incoming) {
      const key = `${student.firstName}|${student.lastName}`.toLowerCase();
      if (namesInClass.has(key)) continue;
      const studentNumber = student.studentNumber && !takenNumbers.has(student.studentNumber) ? student.studentNumber : null;
      if (studentNumber) takenNumbers.add(studentNumber);
      namesInClass.add(key);
      toInsert.push({ ...student, studentNumber });
    }

    if (toInsert.length > 0) {
      await tx.insert(students).values(toInsert.map((student) => ({ teacherId, classId, ...student })));
    }
    return { added: toInsert.length, skipped: incoming.length - toInsert.length };
  });
}

export async function updateStudent(
  db: Database,
  teacherId: string,
  studentId: string,
  input: Partial<StudentInput> & { classId?: string | null },
) {
  try {
    const updated = await db
      .update(students)
      .set(input)
      .where(and(eq(students.id, studentId), eq(students.teacherId, teacherId)))
      .returning({ id: students.id });
    if (updated.length === 0) throw new NotFoundError("That student isn't in your account.");
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    mapStudentError(error);
  }
}

export async function setStudentActive(db: Database, teacherId: string, studentId: string, active: boolean) {
  await updateStudentFlag(db, teacherId, studentId, active);
}

async function updateStudentFlag(db: Database, teacherId: string, studentId: string, active: boolean) {
  const updated = await db
    .update(students)
    .set({ active })
    .where(and(eq(students.id, studentId), eq(students.teacherId, teacherId)))
    .returning({ id: students.id });
  if (updated.length === 0) throw new NotFoundError("That student isn't in your account.");
}

/** Removes a student and their checkout history. Blocked while they still have books out. */
export async function deleteStudent(db: Database, teacherId: string, studentId: string) {
  await db.transaction(async (tx) => {
    const [student] = await tx
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.teacherId, teacherId)))
      .for("update");
    if (!student) throw new NotFoundError("That student isn't in your account.");
    const [{ open }] = await tx
      .select({ open: count() })
      .from(loans)
      .where(and(eq(loans.studentId, studentId), isNull(loans.closedAt)));
    if (open > 0) throw new ConflictError("This student still has books checked out. Check them in first.");
    await tx.delete(loans).where(and(eq(loans.studentId, studentId), eq(loans.teacherId, teacherId)));
    await tx.delete(students).where(eq(students.id, studentId));
  });
}

export async function getStudentDetail(db: Database, teacherId: string, studentId: string) {
  const [student] = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      studentNumber: students.studentNumber,
      active: students.active,
      classId: students.classId,
      className: classes.name,
      schoolYear: classes.schoolYear,
    })
    .from(students)
    .leftJoin(classes, eq(classes.id, students.classId))
    .where(and(eq(students.id, studentId), eq(students.teacherId, teacherId)));
  if (!student) throw new NotFoundError("That student isn't in your account.");

  const loanRows = await db
    .select({
      loanId: loans.id,
      bookId: books.id,
      title: books.title,
      recordedTitle: loans.bookTitle,
      authors: books.authors,
      recordedAuthors: loans.bookAuthors,
      coverUrl: books.coverUrl,
      copyNumber: copies.copyNumber,
      checkedOutAt: loans.checkedOutAt,
      dueOn: loans.dueOn,
      closedAt: loans.closedAt,
      closeReason: loans.closeReason,
    })
    .from(loans)
    // Left joins: a returned book may since have been deleted, and what the student read
    // stays on their record under the title it went out with.
    .leftJoin(copies, eq(copies.id, loans.copyId))
    .leftJoin(books, eq(books.id, loans.bookId))
    .where(and(eq(loans.studentId, studentId), eq(loans.teacherId, teacherId)))
    .orderBy(desc(loans.checkedOutAt));

  const shaped = loanRows.map(({ recordedTitle, recordedAuthors, ...loan }) => ({
    ...loan,
    title: loan.title ?? recordedTitle,
    authors: loan.authors ?? recordedAuthors,
  }));
  return {
    student,
    // An open checkout always has its copy and book: neither can be deleted while it's out.
    current: shaped
      .filter((loan) => loan.closedAt === null)
      .map((loan) => ({ ...loan, bookId: loan.bookId as string, copyNumber: loan.copyNumber as number })),
    history: shaped.filter((loan) => loan.closedAt !== null),
  };
}

export type StudentOption = {
  id: string;
  firstName: string;
  lastName: string;
  classId: string | null;
  className: string | null;
  booksOut: number;
  overdue: number;
};

/** Active students for pickers, optionally filtered by class or name. */
export async function findStudents(
  db: Database,
  teacherId: string,
  options: { today: string; classId?: string; query?: string; limit?: number },
): Promise<StudentOption[]> {
  const conditions: SQL[] = [eq(students.teacherId, teacherId), eq(students.active, true)];
  if (options.classId) conditions.push(eq(students.classId, options.classId));
  const query = options.query?.trim();
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    conditions.push(
      or(
        ilike(students.firstName, pattern),
        ilike(students.lastName, pattern),
        sql`${students.firstName} || ' ' || ${students.lastName} ilike ${pattern}`,
        eq(students.studentNumber, query),
      ) as SQL,
    );
  }
  const rows = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      classId: students.classId,
      className: classes.name,
      ...loanCounts(options.today),
    })
    .from(students)
    .leftJoin(classes, eq(classes.id, students.classId))
    .leftJoin(loans, and(eq(loans.studentId, students.id), isNull(loans.closedAt)))
    .where(and(...conditions))
    .groupBy(students.id, classes.name)
    .orderBy(...studentSortOrder)
    .limit(options.limit ?? 500);
  return rows;
}

/** Moves students (all belonging to the teacher) into another class. */
export async function moveStudents(db: Database, teacherId: string, studentIds: string[], classId: string | null) {
  if (studentIds.length === 0) return;
  if (classId) await requireClass(db, teacherId, classId);
  await db
    .update(students)
    .set({ classId })
    .where(and(eq(students.teacherId, teacherId), inArray(students.id, studentIds)));
}
