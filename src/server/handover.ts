import { and, arrayContains, asc, count, eq, inArray, isNotNull, isNull, max, not, notInArray, or, type SQL, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import {
  books,
  classes,
  classTeacherInvites,
  classTeachers,
  copies,
  handovers,
  loans,
  shelfLoans,
  students,
  user,
} from "@/db/schema";
import { ConflictError, NotFoundError } from "./errors";

/*
 * Handing classes and books to another teacher.
 *
 * The owner offers; nothing moves until the recipient accepts, and everything is checked
 * again at that moment, because a book may have gone out since. Accepting is one
 * transaction: every row that moves has its `teacher_id` rewritten explicitly, with the
 * ownership keys deferred to commit (migration 0007), so the database still refuses the
 * lot unless every row ends up with its parent.
 *
 * What moves with what:
 * - A class takes its students, and a student takes their checkout history.
 * - A book takes its copies. If the recipient already owns the ISBN, the copies join
 *   their title instead of making a second one, the way the lending library does it.
 * - A past checkout that spans the split (the student moves and the book doesn't, or the
 *   other way round) stays with the student and lets go of the book, keeping the title it
 *   went out under, exactly as deleting the book would. A current one is refused: that
 *   book is in a child's hands, and it has to come back first.
 * - The previous owner becomes a co-teacher of every class they handed over.
 */

export type BookSelection =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "tag"; tag: string }
  | { kind: "location"; location: string }
  | { kind: "picked"; bookIds: string[] };

/** Everything the owner can choose from, for the hand-over form. */
export async function listHandoverChoices(db: Database, teacherId: string) {
  const [classRows, bookRows] = await Promise.all([
    db
      .select({
        id: classes.id,
        name: classes.name,
        schoolYear: classes.schoolYear,
        archivedAt: classes.archivedAt,
        students: count(students.id),
      })
      .from(classes)
      .leftJoin(students, and(eq(students.classId, classes.id), eq(students.teacherId, classes.teacherId)))
      .where(eq(classes.teacherId, teacherId))
      .groupBy(classes.id)
      .orderBy(asc(classes.name)),
    db
      .select({ id: books.id, title: books.title, authors: books.authors, tags: books.tags, location: books.location })
      .from(books)
      .where(eq(books.teacherId, teacherId))
      .orderBy(asc(books.title)),
  ]);
  const tally = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].map(([name, books]) => ({ name, books })).sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    classes: classRows.map(({ archivedAt, ...klass }) => ({ ...klass, archived: archivedAt !== null })),
    books: bookRows.map(({ id, title, authors }) => ({ id, title, authors })),
    tags: tally(bookRows.flatMap((book) => book.tags)),
    locations: tally(bookRows.flatMap((book) => (book.location ? [book.location] : []))),
  };
}

async function resolveBooks(db: Database, teacherId: string, selection: BookSelection): Promise<string[]> {
  if (selection.kind === "none") return [];
  const filter =
    selection.kind === "all"
      ? undefined
      : selection.kind === "tag"
        ? arrayContains(books.tags, [selection.tag])
        : selection.kind === "location"
          ? eq(books.location, selection.location)
          : inList(books.id, selection.bookIds);
  const rows = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.teacherId, teacherId), filter));
  return rows.map((row) => row.id);
}

export type OfferOutcome =
  | { status: "sent"; recipientName: string; classes: number; books: number }
  | { status: "blocked"; problems: string[] };

/**
 * Offers classes and books to the teacher with `rawEmail`. Refused up front if accepting
 * would be, so the owner sorts it out before the recipient ever sees it.
 *
 * The recipient needs an account with a verified email (Google, or one an admin created),
 * for the same reason a co-teacher does: this hands over student names, and an unverified
 * address could be anyone's.
 */
export async function offerHandover(
  db: Database,
  fromId: string,
  input: { email: string; classIds: string[]; books: BookSelection },
): Promise<OfferOutcome> {
  const email = input.email.trim().toLowerCase();
  const [recipient] = await db
    .select({ id: user.id, name: user.name, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email));
  if (recipient?.id === fromId) throw new ConflictError("That's you. Choose the teacher who's taking over.");
  if (!recipient?.emailVerified) {
    throw new ConflictError(
      "That email doesn't have an account that can take this yet. Ask them to sign in with Google first, then try again.",
    );
  }

  const [pending] = await db
    .select({ id: handovers.id })
    .from(handovers)
    .where(and(eq(handovers.fromTeacherId, fromId), eq(handovers.status, "pending")));
  if (pending) throw new ConflictError("You already have a hand-over waiting. Withdraw it before offering another.");

  const classIds = (
    await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.teacherId, fromId), inList(classes.id, input.classIds)))
  ).map((row) => row.id);
  const bookIds = await resolveBooks(db, fromId, input.books);
  if (classIds.length === 0 && bookIds.length === 0) throw new ConflictError("Choose at least one class or book to hand over.");

  const problems = await findProblems(db, fromId, recipient.id, classIds, bookIds);
  if (problems.length > 0) return { status: "blocked", problems };

  await db.insert(handovers).values({ fromTeacherId: fromId, toTeacherId: recipient.id, classIds, bookIds });
  return { status: "sent", recipientName: recipient.name, classes: classIds.length, books: bookIds.length };
}

export type HandoverSummary = {
  id: string;
  fromName: string;
  toName: string;
  toEmail: string;
  classNames: string[];
  books: number;
  createdAt: Date;
};

async function summarise(db: Database, where: SQL): Promise<HandoverSummary[]> {
  const sender = alias(user, "handover_from");
  const recipient = alias(user, "handover_to");
  const offers = await db
    .select({
      id: handovers.id,
      fromId: handovers.fromTeacherId,
      fromName: sender.name,
      toName: recipient.name,
      toEmail: recipient.email,
      classIds: handovers.classIds,
      bookIds: handovers.bookIds,
      createdAt: handovers.createdAt,
    })
    .from(handovers)
    .innerJoin(sender, eq(sender.id, handovers.fromTeacherId))
    .innerJoin(recipient, eq(recipient.id, handovers.toTeacherId))
    .where(and(eq(handovers.status, "pending"), where))
    .orderBy(asc(handovers.createdAt));

  // Counted live, so what the recipient is told matches what accepting would move.
  return Promise.all(
    offers.map(async (offer) => {
      const [classRows, [{ bookCount }]] = await Promise.all([
        db
          .select({ name: classes.name })
          .from(classes)
          .where(and(eq(classes.teacherId, offer.fromId), inList(classes.id, offer.classIds)))
          .orderBy(asc(classes.name)),
        db
          .select({ bookCount: count() })
          .from(books)
          .where(and(eq(books.teacherId, offer.fromId), inList(books.id, offer.bookIds))),
      ]);
      return {
        id: offer.id,
        fromName: offer.fromName,
        toName: offer.toName,
        toEmail: offer.toEmail,
        classNames: classRows.map((row) => row.name),
        books: bookCount,
        createdAt: offer.createdAt,
      };
    }),
  );
}

/** The offer this teacher has out, if any. */
export async function pendingHandoverFrom(db: Database, fromId: string): Promise<HandoverSummary | null> {
  const [offer] = await summarise(db, eq(handovers.fromTeacherId, fromId));
  return offer ?? null;
}

/** Offers waiting for this teacher to accept or decline. */
export async function pendingHandoversTo(db: Database, toId: string): Promise<HandoverSummary[]> {
  return summarise(db, eq(handovers.toTeacherId, toId));
}

export async function withdrawHandover(db: Database, fromId: string, handoverId: string): Promise<void> {
  const updated = await db
    .update(handovers)
    .set({ status: "withdrawn", respondedAt: new Date() })
    .where(and(eq(handovers.id, handoverId), eq(handovers.fromTeacherId, fromId), eq(handovers.status, "pending")))
    .returning({ id: handovers.id });
  if (updated.length === 0) throw new NotFoundError("That hand-over has already been answered or withdrawn.");
}

export async function declineHandover(db: Database, toId: string, handoverId: string): Promise<void> {
  const updated = await db
    .update(handovers)
    .set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(handovers.id, handoverId), eq(handovers.toTeacherId, toId), eq(handovers.status, "pending")))
    .returning({ id: handovers.id });
  if (updated.length === 0) throw new NotFoundError("That hand-over has already been answered or withdrawn.");
}

export type AcceptOutcome =
  | { status: "accepted"; fromName: string; classes: number; books: number; joined: number }
  | { status: "blocked"; fromName: string; problems: string[] };

/**
 * Moves everything offered to the recipient, or nothing. A blocked offer stays pending,
 * so it can be accepted once the sender has sorted out what's in the way.
 */
export async function acceptHandover(db: Database, toId: string, handoverId: string): Promise<AcceptOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const [offer] = await tx
        .select({
          fromId: handovers.fromTeacherId,
          fromName: user.name,
          classIds: handovers.classIds,
          bookIds: handovers.bookIds,
        })
        .from(handovers)
        .innerJoin(user, eq(user.id, handovers.fromTeacherId))
        .where(and(eq(handovers.id, handoverId), eq(handovers.toTeacherId, toId), eq(handovers.status, "pending")))
        .for("update", { of: handovers });
      if (!offer) throw new NotFoundError("That hand-over has already been answered or withdrawn.");
      const { fromId, fromName } = offer;

      // Lock what's moving, so nothing is checked out or edited between the checks and the move.
      const classIds = (
        await tx
          .select({ id: classes.id })
          .from(classes)
          .where(and(eq(classes.teacherId, fromId), inList(classes.id, offer.classIds)))
          .for("update")
      ).map((row) => row.id);
      const moving = await tx
        .select({ id: books.id, isbn13: books.isbn13 })
        .from(books)
        .where(and(eq(books.teacherId, fromId), inList(books.id, offer.bookIds)))
        .for("update");
      const bookIds = moving.map((book) => book.id);

      const problems = await findProblems(tx, fromId, toId, classIds, bookIds);
      if (problems.length > 0) return { status: "blocked" as const, fromName, problems };

      await tx.execute(sql`set constraints all deferred`);
      const studentIds = (
        await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.teacherId, fromId), inList(students.classId, classIds)))
          .for("update")
      ).map((row) => row.id);
      const copyIds = (
        await tx
          .select({ id: copies.id })
          .from(copies)
          .where(and(eq(copies.teacherId, fromId), inList(copies.bookId, bookIds)))
      ).map((row) => row.id);

      // Past checkouts that span the split keep the student and let go of the book.
      // (Current ones were refused above.)
      const studentMoves = inList(loans.studentId, studentIds);
      const bookMoves = inList(loans.bookId, bookIds);
      await tx
        .update(loans)
        .set({ copyId: null, bookId: null })
        .where(
          and(
            eq(loans.teacherId, fromId),
            isNotNull(loans.closedAt),
            isNotNull(loans.bookId),
            or(and(studentMoves, not(bookMoves)), and(not(studentMoves), bookMoves)),
          ),
        );

      // Finished lending records for these books. Nothing shows them, and they name the
      // old owner's shelf. Open ones were refused above.
      await tx
        .delete(shelfLoans)
        .where(
          and(
            notInArray(shelfLoans.status, ["requested", "active"]),
            or(
              and(eq(shelfLoans.ownerTeacherId, fromId), inList(shelfLoans.bookId, bookIds)),
              and(eq(shelfLoans.borrowerTeacherId, fromId), inList(shelfLoans.borrowerCopyId, copyIds)),
            ),
          ),
        );

      // Books the recipient already owns join their title as more copies.
      const isbns = moving.flatMap((book) => (book.isbn13 ? [book.isbn13] : []));
      const theirs = isbns.length
        ? await tx
            .select({ id: books.id, isbn13: books.isbn13 })
            .from(books)
            .where(and(eq(books.teacherId, toId), inArray(books.isbn13, isbns)))
        : [];
      const joinInto = new Map(theirs.map((book) => [book.isbn13, book.id]));
      const joining = moving.filter((book) => book.isbn13 && joinInto.has(book.isbn13));
      for (const book of joining) {
        const targetId = joinInto.get(book.isbn13)!;
        const [{ highest }] = await tx.select({ highest: max(copies.copyNumber) }).from(copies).where(eq(copies.bookId, targetId));
        const itsCopies = await tx
          .select({ id: copies.id })
          .from(copies)
          .where(eq(copies.bookId, book.id))
          .orderBy(asc(copies.copyNumber));
        for (const [index, copy] of itsCopies.entries()) {
          await tx
            .update(copies)
            .set({ teacherId: toId, bookId: targetId, copyNumber: (highest ?? 0) + index + 1 })
            .where(eq(copies.id, copy.id));
        }
        await tx.update(loans).set({ bookId: targetId }).where(eq(loans.bookId, book.id));
        await tx.delete(books).where(and(eq(books.id, book.id), eq(books.teacherId, fromId)));
      }

      const whole = bookIds.filter((id) => !joining.some((book) => book.id === id));
      if (whole.length > 0) {
        await tx.update(books).set({ teacherId: toId }).where(and(eq(books.teacherId, fromId), inArray(books.id, whole)));
        await tx.update(copies).set({ teacherId: toId }).where(and(eq(copies.teacherId, fromId), inArray(copies.bookId, whole)));
      }

      if (classIds.length > 0) {
        await tx.update(classes).set({ teacherId: toId }).where(and(eq(classes.teacherId, fromId), inArray(classes.id, classIds)));
        if (studentIds.length > 0) {
          await tx.update(students).set({ teacherId: toId }).where(and(eq(students.teacherId, fromId), inArray(students.id, studentIds)));
          await tx.update(loans).set({ teacherId: toId }).where(and(eq(loans.teacherId, fromId), inArray(loans.studentId, studentIds)));
        }

        // Co-teachers stay on, now under the new owner, except the new owner themselves;
        // and the previous owner joins them.
        const [{ email: toEmail }] = await tx.select({ email: user.email }).from(user).where(eq(user.id, toId));
        await tx.delete(classTeachers).where(and(inArray(classTeachers.classId, classIds), eq(classTeachers.coTeacherId, toId)));
        await tx.update(classTeachers).set({ ownerTeacherId: toId }).where(inArray(classTeachers.classId, classIds));
        await tx
          .insert(classTeachers)
          .values(classIds.map((classId) => ({ classId, ownerTeacherId: toId, coTeacherId: fromId })))
          .onConflictDoNothing();
        await tx
          .delete(classTeacherInvites)
          .where(and(inArray(classTeacherInvites.classId, classIds), eq(classTeacherInvites.email, toEmail.toLowerCase())));
        await tx.update(classTeacherInvites).set({ ownerTeacherId: toId }).where(inArray(classTeacherInvites.classId, classIds));
      }

      await tx.update(handovers).set({ status: "accepted", respondedAt: new Date() }).where(eq(handovers.id, handoverId));
      return { status: "accepted" as const, fromName, classes: classIds.length, books: bookIds.length, joined: joining.length };
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    // Something moved underneath between the checks and the commit (a checkout, a student
    // ID taken), and the database refused the whole thing. Nothing was changed.
    console.error(error);
    throw new ConflictError("Something changed in one of the libraries while this was moving, so nothing was moved. Try again.");
  }
}

const MAX_PROBLEMS = 8;

/**
 * Everything that would stop this hand-over, in words the sender can act on. Empty means
 * it can go ahead.
 */
async function findProblems(
  db: Database,
  fromId: string,
  toId: string,
  classIds: string[],
  bookIds: string[],
): Promise<string[]> {
  const problems: string[] = [];
  const studentMoves = inList(students.classId, classIds);

  // Books in children's hands, where the child and the book would end up in different classrooms.
  const open = await db
    .select({
      title: books.title,
      copyNumber: copies.copyNumber,
      bookId: loans.bookId,
      firstName: students.firstName,
      lastName: students.lastName,
      classId: students.classId,
      className: classes.name,
    })
    .from(loans)
    .innerJoin(students, and(eq(students.id, loans.studentId), eq(students.teacherId, loans.teacherId)))
    .leftJoin(classes, and(eq(classes.id, students.classId), eq(classes.teacherId, students.teacherId)))
    .innerJoin(copies, and(eq(copies.id, loans.copyId), eq(copies.teacherId, loans.teacherId)))
    .innerJoin(books, and(eq(books.id, copies.bookId), eq(books.teacherId, copies.teacherId)))
    .where(and(eq(loans.teacherId, fromId), isNull(loans.closedAt), or(studentMoves, inList(loans.bookId, bookIds))))
    .orderBy(asc(books.title));
  for (const loan of open) {
    const studentGoes = loan.classId !== null && classIds.includes(loan.classId);
    const bookGoes = loan.bookId !== null && bookIds.includes(loan.bookId);
    if (studentGoes === bookGoes) continue;
    const who = `${loan.firstName} ${loan.lastName}`.trim() + (loan.className ? ` (${loan.className})` : "");
    problems.push(
      bookGoes
        ? `${loan.title}, copy ${loan.copyNumber}, is checked out to ${who}, who isn't part of this hand-over. Check it in first.`
        : `${who} has ${loan.title}, copy ${loan.copyNumber}, which isn't part of this hand-over. Check it in first.`,
    );
  }

  // Books lent to or borrowed from another teacher, or asked for.
  if (bookIds.length > 0) {
    const lending = await db
      .select({ title: books.title, status: shelfLoans.status, ownerId: shelfLoans.ownerTeacherId })
      .from(shelfLoans)
      .innerJoin(copies, or(eq(copies.id, shelfLoans.copyId), eq(copies.id, shelfLoans.borrowerCopyId)))
      .innerJoin(books, and(eq(books.id, copies.bookId), eq(books.teacherId, copies.teacherId)))
      .where(
        and(
          inArray(books.id, bookIds),
          eq(books.teacherId, fromId),
          or(
            and(eq(shelfLoans.ownerTeacherId, fromId), eq(shelfLoans.status, "active")),
            and(eq(shelfLoans.borrowerTeacherId, fromId), eq(shelfLoans.status, "active")),
          ),
        ),
      );
    const requested = await db
      .select({ title: books.title })
      .from(shelfLoans)
      .innerJoin(books, and(eq(books.id, shelfLoans.bookId), eq(books.teacherId, shelfLoans.ownerTeacherId)))
      .where(and(eq(shelfLoans.ownerTeacherId, fromId), eq(shelfLoans.status, "requested"), inArray(books.id, bookIds)));
    for (const loan of lending) {
      problems.push(
        loan.ownerId === fromId
          ? `${loan.title} is lent to another teacher. It has to come back first.`
          : `${loan.title} is borrowed from another teacher. Send it back first.`,
      );
    }
    for (const request of requested) {
      problems.push(`Another teacher has asked to borrow ${request.title}. Answer the request first.`);
    }
  }

  // Student ID numbers the recipient already uses.
  if (classIds.length > 0) {
    const theirStudents = alias(students, "their_students");
    const clashes = await db
      .select({ studentNumber: students.studentNumber, firstName: students.firstName, lastName: students.lastName })
      .from(students)
      .where(
        and(
          eq(students.teacherId, fromId),
          studentMoves,
          isNotNull(students.studentNumber),
          inArray(
            students.studentNumber,
            db
              .select({ number: theirStudents.studentNumber })
              .from(theirStudents)
              .where(and(eq(theirStudents.teacherId, toId), isNotNull(theirStudents.studentNumber))),
          ),
        ),
      );
    for (const clash of clashes) {
      problems.push(
        `${`${clash.firstName} ${clash.lastName}`.trim()}'s student ID, ${clash.studentNumber}, is already used by one of the other teacher's students. Change one of them first.`,
      );
    }
  }

  if (problems.length > MAX_PROBLEMS) {
    const rest = problems.length - MAX_PROBLEMS;
    return [...problems.slice(0, MAX_PROBLEMS), `And ${rest} more like ${rest === 1 ? "it" : "them"}.`];
  }
  return problems;
}

/** `column in ids`, where an empty list matches nothing rather than everything. */
function inList(column: PgColumn, ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`false` : inArray(column, [...ids]);
}
