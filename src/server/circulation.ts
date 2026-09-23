import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, notExists, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { books, classes, copies, loans, students, teacherSettings } from "@/db/schema";
import { ConflictError, isUniqueViolation, LimitError, NotFoundError } from "./errors";

/** How long a checkout or return can be undone. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

const studentName = sql<string>`trim(${students.firstName} || ' ' || ${students.lastName})`;

export type CheckoutResult = {
  loanId: string;
  bookId: string;
  title: string;
  coverUrl: string | null;
  copyNumber: number;
  studentId: string;
  studentName: string;
  dueOn: string | null;
};

/** Checks out the lowest-numbered available copy of a book. Safe under concurrent requests. */
export async function checkOutBook(
  db: Database,
  teacherId: string,
  input: { studentId: string; bookId: string; dueOn: string | null },
): Promise<CheckoutResult> {
  try {
    return await db.transaction(async (tx) => {
      const [student] = await tx
        .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, active: students.active })
        .from(students)
        .where(and(eq(students.id, input.studentId), eq(students.teacherId, teacherId)))
        .for("update");
      if (!student) throw new NotFoundError("That student isn't in your account.");
      const name = `${student.firstName} ${student.lastName}`.trim();
      if (!student.active) throw new ConflictError(`${name} is inactive. Mark them active to check out books.`);

      const [settings] = await tx
        .select({ max: teacherSettings.maxBooksPerStudent })
        .from(teacherSettings)
        .where(eq(teacherSettings.teacherId, teacherId));
      if (settings?.max) {
        const [{ open }] = await tx
          .select({ open: count() })
          .from(loans)
          .where(and(eq(loans.studentId, student.id), isNull(loans.closedAt)));
        if (open >= settings.max) {
          throw new LimitError(
            `${student.firstName} already has ${open} ${open === 1 ? "book" : "books"} out. The limit is ${settings.max}.`,
          );
        }
      }

      const [book] = await tx
        .select({ id: books.id, title: books.title, authors: books.authors, coverUrl: books.coverUrl })
        .from(books)
        .where(and(eq(books.id, input.bookId), eq(books.teacherId, teacherId)));
      if (!book) throw new NotFoundError("That book isn't in your library.");

      const openLoan = alias(loans, "open_loan");
      const [copy] = await tx
        .select({ id: copies.id, copyNumber: copies.copyNumber })
        .from(copies)
        .where(
          and(
            eq(copies.bookId, book.id),
            eq(copies.teacherId, teacherId),
            eq(copies.status, "in_circulation"),
            notExists(
              tx
                .select({ id: openLoan.id })
                .from(openLoan)
                .where(and(eq(openLoan.copyId, copies.id), isNull(openLoan.closedAt))),
            ),
          ),
        )
        .orderBy(asc(copies.copyNumber))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!copy) throw new ConflictError(`Every copy of ${book.title} is checked out.`);

      const [loan] = await tx
        .insert(loans)
        .values({
          teacherId,
          copyId: copy.id,
          bookId: book.id,
          bookTitle: book.title,
          bookAuthors: book.authors,
          studentId: student.id,
          dueOn: input.dueOn,
        })
        .returning({ id: loans.id });

      return {
        loanId: loan.id,
        bookId: book.id,
        title: book.title,
        coverUrl: book.coverUrl,
        copyNumber: copy.copyNumber,
        studentId: student.id,
        studentName: name,
        dueOn: input.dueOn,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, "loans_one_open_per_copy")) {
      throw new ConflictError("That copy was checked out a moment ago. Try again.");
    }
    throw error;
  }
}

async function loanSummary(db: Database, teacherId: string, loanId: string) {
  const [loan] = await db
    .select({
      loanId: loans.id,
      copyId: loans.copyId,
      bookId: books.id,
      title: books.title,
      copyNumber: copies.copyNumber,
      studentId: students.id,
      studentName,
      checkedOutAt: loans.checkedOutAt,
      closedAt: loans.closedAt,
      closeReason: loans.closeReason,
    })
    .from(loans)
    .innerJoin(copies, eq(copies.id, loans.copyId))
    .innerJoin(books, eq(books.id, copies.bookId))
    .innerJoin(students, eq(students.id, loans.studentId))
    .where(and(eq(loans.id, loanId), eq(loans.teacherId, teacherId)));
  if (!loan) throw new NotFoundError("That checkout wasn't found.");
  return loan;
}

export type ReturnResult = { loanId: string; bookId: string; title: string; copyNumber: number; studentName: string };

export async function checkInLoan(db: Database, teacherId: string, loanId: string): Promise<ReturnResult> {
  const closed = await db
    .update(loans)
    .set({ closedAt: new Date(), closeReason: "returned" })
    .where(and(eq(loans.id, loanId), eq(loans.teacherId, teacherId), isNull(loans.closedAt)))
    .returning({ id: loans.id });
  const loan = await loanSummary(db, teacherId, loanId);
  if (closed.length === 0) throw new ConflictError(`${loan.title} was already checked in.`);
  return { loanId, bookId: loan.bookId, title: loan.title, copyNumber: loan.copyNumber, studentName: loan.studentName };
}

/** Reopens a loan returned in the last few minutes. */
export async function undoCheckIn(db: Database, teacherId: string, loanId: string, now = new Date()): Promise<void> {
  try {
    const reopened = await db
      .update(loans)
      .set({ closedAt: null, closeReason: null })
      .where(
        and(
          eq(loans.id, loanId),
          eq(loans.teacherId, teacherId),
          eq(loans.closeReason, "returned"),
          gte(loans.closedAt, new Date(now.getTime() - UNDO_WINDOW_MS)),
          // Returned and then deleted within the undo window: there is no copy to reopen.
          isNotNull(loans.copyId),
        ),
      )
      .returning({ id: loans.id });
    if (reopened.length === 0) {
      const [deleted] = await db
        .select({ id: loans.id })
        .from(loans)
        .where(and(eq(loans.id, loanId), eq(loans.teacherId, teacherId), isNull(loans.copyId)));
      if (deleted) throw new ConflictError("That copy has been deleted, so the return can't be undone.");
      await loanSummary(db, teacherId, loanId);
      throw new ConflictError("That return can't be undone anymore.");
    }
  } catch (error) {
    if (isUniqueViolation(error, "loans_one_open_per_copy")) {
      throw new ConflictError("That copy has already been checked out again, so the return can't be undone.");
    }
    throw error;
  }
}

/** Removes a checkout made in the last few minutes, as if it never happened. */
export async function undoCheckOut(db: Database, teacherId: string, loanId: string, now = new Date()): Promise<void> {
  const removed = await db
    .delete(loans)
    .where(
      and(
        eq(loans.id, loanId),
        eq(loans.teacherId, teacherId),
        isNull(loans.closedAt),
        gte(loans.checkedOutAt, new Date(now.getTime() - UNDO_WINDOW_MS)),
      ),
    )
    .returning({ id: loans.id });
  if (removed.length === 0) {
    await loanSummary(db, teacherId, loanId);
    throw new ConflictError("That checkout can't be undone anymore. Check the book in instead.");
  }
}

/** Closes the loan as lost and marks the copy lost. */
export async function markLoanLost(db: Database, teacherId: string, loanId: string): Promise<ReturnResult> {
  return db.transaction(async (tx) => {
    const [loan] = await tx
      .update(loans)
      .set({ closedAt: new Date(), closeReason: "lost" })
      .where(and(eq(loans.id, loanId), eq(loans.teacherId, teacherId), isNull(loans.closedAt)))
      .returning({ copyId: loans.copyId });
    if (!loan) {
      const existing = await loanSummary(tx, teacherId, loanId);
      throw new ConflictError(`${existing.title} was already checked in.`);
    }
    // `loans_open_has_copy`: the loan was open a moment ago, so its copy is still there.
    const copyId = loan.copyId as string;
    await tx.update(copies).set({ status: "lost" }).where(and(eq(copies.id, copyId), eq(copies.teacherId, teacherId)));
    const summary = await loanSummary(tx, teacherId, loanId);
    return { loanId, bookId: summary.bookId, title: summary.title, copyNumber: summary.copyNumber, studentName: summary.studentName };
  });
}

export type OpenLoan = {
  loanId: string;
  bookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  copyNumber: number;
  studentId: string;
  studentName: string;
  classId: string | null;
  className: string | null;
  checkedOutAt: Date;
  dueOn: string | null;
  overdue: boolean;
};

export async function listOpenLoans(
  db: Database,
  teacherId: string,
  options: { today: string; bookId?: string; studentId?: string; overdueOnly?: boolean; limit?: number },
): Promise<OpenLoan[]> {
  const conditions: SQL[] = [eq(loans.teacherId, teacherId), isNull(loans.closedAt)];
  if (options.bookId) conditions.push(eq(books.id, options.bookId));
  if (options.studentId) conditions.push(eq(loans.studentId, options.studentId));
  if (options.overdueOnly) conditions.push(sql`${loans.dueOn} < ${options.today}`);

  return db
    .select({
      loanId: loans.id,
      bookId: books.id,
      title: books.title,
      authors: books.authors,
      coverUrl: books.coverUrl,
      copyNumber: copies.copyNumber,
      studentId: students.id,
      studentName,
      classId: classes.id,
      className: classes.name,
      checkedOutAt: loans.checkedOutAt,
      dueOn: loans.dueOn,
      overdue: sql<boolean>`coalesce(${loans.dueOn} < ${options.today}, false)`,
    })
    .from(loans)
    .innerJoin(copies, eq(copies.id, loans.copyId))
    .innerJoin(books, eq(books.id, copies.bookId))
    .innerJoin(students, eq(students.id, loans.studentId))
    .leftJoin(classes, eq(classes.id, students.classId))
    .where(and(...conditions))
    .orderBy(asc(sql`${loans.dueOn} is null`), asc(loans.dueOn), asc(loans.checkedOutAt))
    .limit(options.limit ?? 1000);
}

export async function circulationStats(db: Database, teacherId: string, today: string, timeZone: string) {
  const [row] = await db
    .select({
      booksOut: sql<number>`count(*) filter (where ${loans.closedAt} is null)`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${loans.closedAt} is null and ${loans.dueOn} < ${today})`.mapWith(Number),
      dueToday: sql<number>`count(*) filter (where ${loans.closedAt} is null and ${loans.dueOn} = ${today})`.mapWith(Number),
      checkedOutToday: sql<number>`count(*) filter (where (${loans.checkedOutAt} at time zone ${timeZone})::date = ${today}::date)`.mapWith(Number),
      returnedToday: sql<number>`count(*) filter (where ${loans.closeReason} = 'returned' and (${loans.closedAt} at time zone ${timeZone})::date = ${today}::date)`.mapWith(Number),
    })
    .from(loans)
    .where(eq(loans.teacherId, teacherId));
  return row;
}

export type ActivityItem = {
  loanId: string;
  kind: "checked_out" | "returned" | "lost";
  at: Date;
  /** Null when the book has since been deleted. */
  bookId: string | null;
  title: string;
  coverUrl: string | null;
  studentId: string;
  studentName: string;
};

/** The most recent checkouts and returns, newest first. */
export async function recentActivity(db: Database, teacherId: string, limit = 8): Promise<ActivityItem[]> {
  const rows = await db
    .select({
      loanId: loans.id,
      checkedOutAt: loans.checkedOutAt,
      closedAt: loans.closedAt,
      closeReason: loans.closeReason,
      bookId: books.id,
      title: books.title,
      recordedTitle: loans.bookTitle,
      coverUrl: books.coverUrl,
      studentId: students.id,
      studentName,
    })
    .from(loans)
    .leftJoin(books, eq(books.id, loans.bookId))
    .innerJoin(students, eq(students.id, loans.studentId))
    .where(eq(loans.teacherId, teacherId))
    .orderBy(desc(sql`coalesce(${loans.closedAt}, ${loans.checkedOutAt})`))
    .limit(limit);

  const events: ActivityItem[] = [];
  for (const row of rows) {
    const base = {
      loanId: row.loanId,
      bookId: row.bookId,
      // The book's current title while it exists; the one it went out under once it's gone.
      title: row.title ?? row.recordedTitle,
      coverUrl: row.coverUrl,
      studentId: row.studentId,
      studentName: row.studentName,
    };
    if (row.closedAt) events.push({ ...base, kind: row.closeReason === "lost" ? "lost" : "returned", at: row.closedAt });
    events.push({ ...base, kind: "checked_out", at: row.checkedOutAt });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Books for the checkout picker: title, author, or ISBN matches with availability. */
export async function findBooksToCheckOut(db: Database, teacherId: string, query: string, limit = 8) {
  const pattern = `%${query.trim().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
  return db
    .select({
      id: books.id,
      title: books.title,
      authors: books.authors,
      coverUrl: books.coverUrl,
      total: sql<number>`count(${copies.id}) filter (where ${copies.status} = 'in_circulation')`.mapWith(Number),
      available: sql<number>`count(${copies.id}) filter (where ${copies.status} = 'in_circulation' and not exists (select 1 from ${loans} where ${loans.copyId} = ${copies.id} and ${loans.closedAt} is null))`.mapWith(Number),
    })
    .from(books)
    .leftJoin(copies, eq(copies.bookId, books.id))
    .where(
      and(
        eq(books.teacherId, teacherId),
        or(ilike(books.title, pattern), sql`array_to_string(${books.authors}, ' ') ilike ${pattern}`) as SQL,
      ),
    )
    .groupBy(books.id)
    .orderBy(asc(sql`lower(${books.title})`))
    .limit(limit);
}
