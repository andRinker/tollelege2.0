import { and, arrayContains, asc, count, eq, inArray, isNotNull, isNull, max, ne, not, notInArray, or, type SQL, sql } from "drizzle-orm";
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
import { renumberCopies } from "./copy-numbers";
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
 * - Some of a title's copies can go on their own. They join the recipient's title, or
 *   start a new one with the same details, and the sender keeps the rest.
 * - A past checkout that spans the split (the student moves and the copy doesn't, or the
 *   other way round) stays with the student and lets go of the copy, keeping the title it
 *   went out under, exactly as deleting the copy would. A current one is refused: that
 *   book is in a child's hands, and it has to come back first.
 * - The previous owner becomes a co-teacher of every class they handed over.
 */

export type BookSelection =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "tag"; tag: string }
  | { kind: "location"; location: string }
  /** `copies` null means every copy: the whole title. */
  | { kind: "picked"; books: { bookId: string; copies: number | null }[] };

/** What an offer moves: whole titles, and single copies from titles the sender keeps. */
type Moving = { bookIds: string[]; copyIds: string[] };

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
      .select({
        id: books.id,
        title: books.title,
        authors: books.authors,
        tags: books.tags,
        location: books.location,
        copies: count(copies.id),
      })
      .from(books)
      .leftJoin(copies, and(eq(copies.bookId, books.id), eq(copies.teacherId, books.teacherId)))
      .where(eq(books.teacherId, teacherId))
      .groupBy(books.id)
      .orderBy(asc(books.title)),
  ]);
  const tally = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].map(([name, books]) => ({ name, books })).sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    classes: classRows.map(({ archivedAt, ...klass }) => ({ ...klass, archived: archivedAt !== null })),
    books: bookRows.map(({ id, title, authors, copies }) => ({ id, title, authors, copies })),
    tags: tally(bookRows.flatMap((book) => book.tags)),
    locations: tally(bookRows.flatMap((book) => (book.location ? [book.location] : []))),
  };
}

async function resolveBooks(db: Database, teacherId: string, selection: BookSelection): Promise<Moving> {
  if (selection.kind === "none") return { bookIds: [], copyIds: [] };
  if (selection.kind === "picked") return resolvePicked(db, teacherId, selection.books);
  const filter =
    selection.kind === "all"
      ? undefined
      : selection.kind === "tag"
        ? arrayContains(books.tags, [selection.tag])
        : eq(books.location, selection.location);
  const rows = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.teacherId, teacherId), filter));
  return { bookIds: rows.map((row) => row.id), copyIds: [] };
}

/**
 * Picked titles, some with only a number of their copies. Which copies is chosen here, so
 * the offer names exactly what moves: ones on the shelf first, then ones out with a
 * student, then damaged, lost or withdrawn ones, and the highest-numbered of each before
 * the lowest, so the sender keeps their copy 1. Asking for every copy is the whole title.
 */
async function resolvePicked(
  db: Database,
  teacherId: string,
  picks: { bookId: string; copies: number | null }[],
): Promise<Moving> {
  const wanted = new Map(picks.map((pick) => [pick.bookId, pick.copies]));
  const owned = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.teacherId, teacherId), inList(books.id, [...wanted.keys()])));
  const rows = await db
    .select({ id: copies.id, bookId: copies.bookId, copyNumber: copies.copyNumber, status: copies.status, loanId: loans.id })
    .from(copies)
    .leftJoin(loans, and(eq(loans.copyId, copies.id), eq(loans.teacherId, copies.teacherId), isNull(loans.closedAt)))
    .where(and(eq(copies.teacherId, teacherId), inList(copies.bookId, owned.map((book) => book.id))));

  const rank = (copy: (typeof rows)[number]) =>
    copy.status === "in_circulation" ? (copy.loanId ? 1 : 0) : copy.status === "damaged" ? 2 : 3;
  const moving: Moving = { bookIds: [], copyIds: [] };
  for (const { id } of owned) {
    const itsCopies = rows.filter((copy) => copy.bookId === id);
    const howMany = wanted.get(id);
    if (howMany == null || howMany >= itsCopies.length) {
      moving.bookIds.push(id);
      continue;
    }
    const chosen = itsCopies.sort((a, b) => rank(a) - rank(b) || b.copyNumber - a.copyNumber).slice(0, howMany);
    moving.copyIds.push(...chosen.map((copy) => copy.id));
  }
  return moving;
}

/** Every class and every book the teacher has right now. */
async function entireLibrary(db: Database, teacherId: string): Promise<Moving & { classIds: string[] }> {
  const [classRows, bookRows] = await Promise.all([
    db.select({ id: classes.id }).from(classes).where(eq(classes.teacherId, teacherId)),
    db.select({ id: books.id }).from(books).where(eq(books.teacherId, teacherId)),
  ]);
  return { classIds: classRows.map((row) => row.id), bookIds: bookRows.map((row) => row.id), copyIds: [] };
}

/** What an offer covers now: what it named, or for "everything", the library as it stands. */
async function offerContents(
  db: Database,
  fromId: string,
  offer: { everything: boolean; classIds: string[]; bookIds: string[]; copyIds: string[] },
): Promise<Moving & { classIds: string[] }> {
  if (offer.everything) return entireLibrary(db, fromId);
  return { classIds: offer.classIds, bookIds: offer.bookIds, copyIds: offer.copyIds };
}

/** How many titles and copies an offer moves, counted as the libraries stand now. */
async function countMoving(db: Database, fromId: string, moving: Moving): Promise<{ books: number; copies: number }> {
  const [whole, rows] = await Promise.all([
    db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.teacherId, fromId), inList(books.id, moving.bookIds))),
    db
      .select({ bookId: copies.bookId })
      .from(copies)
      .where(and(eq(copies.teacherId, fromId), or(inList(copies.bookId, moving.bookIds), inList(copies.id, moving.copyIds)))),
  ]);
  return { books: new Set([...whole.map((book) => book.id), ...rows.map((row) => row.bookId)]).size, copies: rows.length };
}

export type OfferOutcome =
  | {
      status: "sent";
      /** Null while the offer waits for a colleague who hasn't signed in yet. */
      recipientName: string | null;
      email: string;
      classes: number;
      books: number;
      copies: number;
    }
  | { status: "blocked"; problems: string[] };

/**
 * Offers classes and books to the teacher with `rawEmail`. Refused up front if accepting
 * would be, so the owner sorts it out before the recipient ever sees it.
 *
 * Only an account with a verified email (Google, or one an admin created) can take it, for
 * the same reason as a co-teacher: this hands over student names, and an unverified
 * address could be anyone's. For anyone else the offer waits on the email, and is claimed
 * by the first verified sign-in with it (`claimHandovers`), exactly like a co-teacher invite.
 */
export async function offerHandover(
  db: Database,
  fromId: string,
  input: { email: string; classIds: string[]; books: BookSelection; everything?: boolean },
): Promise<OfferOutcome> {
  const email = input.email.trim().toLowerCase();
  const [recipient] = await db
    .select({ id: user.id, name: user.name, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email));
  if (recipient?.id === fromId) throw new ConflictError("That's you. Choose the teacher who's taking over.");
  const toId = recipient?.emailVerified ? recipient.id : null;

  const [pending] = await db
    .select({ id: handovers.id })
    .from(handovers)
    .where(and(eq(handovers.fromTeacherId, fromId), eq(handovers.status, "pending")));
  if (pending) throw new ConflictError("You already have a hand-over waiting. Withdraw it before offering another.");

  const everything = Boolean(input.everything);
  const { classIds, ...moving } = everything
    ? await entireLibrary(db, fromId)
    : {
        classIds: (
          await db
            .select({ id: classes.id })
            .from(classes)
            .where(and(eq(classes.teacherId, fromId), inList(classes.id, input.classIds)))
        ).map((row) => row.id),
        ...(await resolveBooks(db, fromId, input.books)),
      };
  if (classIds.length === 0 && moving.bookIds.length === 0 && moving.copyIds.length === 0) {
    throw new ConflictError(everything ? "Your library is empty, so there's nothing to hand over." : "Choose at least one class or book to hand over.");
  }

  const problems = await findProblems(db, fromId, toId, classIds, moving);
  if (problems.length > 0) return { status: "blocked", problems };

  // "Everything" is stored as such, and resolved again when it's accepted.
  await db
    .insert(handovers)
    .values(
      everything
        ? { fromTeacherId: fromId, toTeacherId: toId, toEmail: email, everything }
        : { fromTeacherId: fromId, toTeacherId: toId, toEmail: email, classIds, ...moving },
    );
  return {
    status: "sent",
    recipientName: toId ? recipient!.name : null,
    email,
    classes: classIds.length,
    ...(await countMoving(db, fromId, moving)),
  };
}

export type HandoverSummary = {
  id: string;
  fromName: string;
  /** Null while the offer waits for a colleague who hasn't signed in yet. */
  toName: string | null;
  toEmail: string;
  classNames: string[];
  /** The sender's entire library, whatever it holds when accepted. */
  everything: boolean;
  /** Titles, whole or in part. */
  books: number;
  copies: number;
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
      recipientEmail: recipient.email,
      addressedTo: handovers.toEmail,
      classIds: handovers.classIds,
      bookIds: handovers.bookIds,
      copyIds: handovers.copyIds,
      everything: handovers.everything,
      createdAt: handovers.createdAt,
    })
    .from(handovers)
    .innerJoin(sender, eq(sender.id, handovers.fromTeacherId))
    .leftJoin(recipient, eq(recipient.id, handovers.toTeacherId))
    .where(and(eq(handovers.status, "pending"), where))
    .orderBy(asc(handovers.createdAt));

  // Counted live, so what the recipient is told matches what accepting would move.
  return Promise.all(
    offers.map(async (offer) => {
      const contents = await offerContents(db, offer.fromId, offer);
      const [classRows, moving] = await Promise.all([
        db
          .select({ name: classes.name })
          .from(classes)
          .where(and(eq(classes.teacherId, offer.fromId), inList(classes.id, contents.classIds)))
          .orderBy(asc(classes.name)),
        countMoving(db, offer.fromId, contents),
      ]);
      return {
        id: offer.id,
        fromName: offer.fromName,
        toName: offer.toName,
        toEmail: offer.addressedTo ?? offer.recipientEmail ?? "",
        classNames: classRows.map((row) => row.name),
        everything: offer.everything,
        ...moving,
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

/**
 * Gives a waiting offer to the teacher it was addressed to, the first time they're signed
 * in with that email verified. Called from the app layout, like `claimCoTeacherInvites`.
 */
export async function claimHandovers(
  db: Database,
  account: { id: string; email: string; emailVerified: boolean },
): Promise<number> {
  if (!account.emailVerified) return 0;
  const claimed = await db
    .update(handovers)
    .set({ toTeacherId: account.id })
    .where(
      and(
        eq(handovers.toEmail, account.email.toLowerCase()),
        isNull(handovers.toTeacherId),
        eq(handovers.status, "pending"),
        ne(handovers.fromTeacherId, account.id),
      ),
    )
    .returning({ id: handovers.id });
  return claimed.length;
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
          copyIds: handovers.copyIds,
          everything: handovers.everything,
        })
        .from(handovers)
        .innerJoin(user, eq(user.id, handovers.fromTeacherId))
        .where(and(eq(handovers.id, handoverId), eq(handovers.toTeacherId, toId), eq(handovers.status, "pending")))
        .for("update", { of: handovers });
      if (!offer) throw new NotFoundError("That hand-over has already been answered or withdrawn.");
      const { fromId, fromName } = offer;
      Object.assign(offer, await offerContents(tx, fromId, offer));

      // Lock what's moving, so nothing is checked out or edited between the checks and the move.
      const classIds = (
        await tx
          .select({ id: classes.id })
          .from(classes)
          .where(and(eq(classes.teacherId, fromId), inList(classes.id, offer.classIds)))
          .for("update")
      ).map((row) => row.id);
      let partial = await tx
        .select({ id: copies.id, bookId: copies.bookId, copyNumber: copies.copyNumber })
        .from(copies)
        .where(and(eq(copies.teacherId, fromId), inList(copies.id, offer.copyIds), not(inList(copies.bookId, offer.bookIds))))
        .orderBy(asc(copies.copyNumber))
        .for("update");

      // Copies given from a title that has none left besides them (the rest deleted since
      // the offer) move as the whole title, so the sender isn't left with an empty one.
      const partialBookIds = [...new Set(partial.map((copy) => copy.bookId))];
      const totals = partialBookIds.length
        ? await tx
            .select({ bookId: copies.bookId, total: count() })
            .from(copies)
            .where(inArray(copies.bookId, partialBookIds))
            .groupBy(copies.bookId)
        : [];
      const emptied = totals
        .filter((row) => row.total === partial.filter((copy) => copy.bookId === row.bookId).length)
        .map((row) => row.bookId);
      partial = partial.filter((copy) => !emptied.includes(copy.bookId));

      const moving = await tx
        .select({ id: books.id, isbn13: books.isbn13 })
        .from(books)
        .where(and(eq(books.teacherId, fromId), inList(books.id, [...offer.bookIds, ...emptied])))
        .for("update");
      const bookIds = moving.map((book) => book.id);
      const partialIds = partial.map((copy) => copy.id);

      const problems = await findProblems(tx, fromId, toId, classIds, { bookIds, copyIds: partialIds });
      if (problems.length > 0) return { status: "blocked" as const, fromName, problems };

      await tx.execute(sql`set constraints all deferred`);
      const studentIds = (
        await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.teacherId, fromId), inList(students.classId, classIds)))
          .for("update")
      ).map((row) => row.id);
      const copyIds = [
        ...(
          await tx
            .select({ id: copies.id })
            .from(copies)
            .where(and(eq(copies.teacherId, fromId), inList(copies.bookId, bookIds)))
        ).map((row) => row.id),
        ...partialIds,
      ];

      // Past checkouts that span the split keep the student and let go of what doesn't go
      // with them. (Current ones were refused above.)
      const past = and(eq(loans.teacherId, fromId), isNotNull(loans.closedAt));
      const studentMoves = inList(loans.studentId, studentIds);
      // A student who stays keeps their history of a copy that goes: of the copy, and of the
      // title too if the whole title goes.
      await tx.update(loans).set({ copyId: null }).where(and(past, not(studentMoves), inList(loans.copyId, copyIds)));
      await tx.update(loans).set({ bookId: null }).where(and(past, not(studentMoves), inList(loans.bookId, bookIds)));
      // A student who goes lets go of a copy that stays.
      await tx
        .update(loans)
        .set({ copyId: null, bookId: null })
        .where(
          and(
            past,
            studentMoves,
            or(isNull(loans.bookId), not(inList(loans.bookId, bookIds))),
            or(isNull(loans.copyId), not(inList(loans.copyId, partialIds))),
          ),
        );

      // Finished lending records for these books and copies. Nothing shows them, and they
      // name the old owner's shelf. Open ones were refused above.
      await tx
        .delete(shelfLoans)
        .where(
          and(
            notInArray(shelfLoans.status, ["requested", "active"]),
            or(
              and(
                eq(shelfLoans.ownerTeacherId, fromId),
                or(inList(shelfLoans.bookId, bookIds), inList(shelfLoans.copyId, partialIds)),
              ),
              and(eq(shelfLoans.borrowerTeacherId, fromId), inList(shelfLoans.borrowerCopyId, copyIds)),
            ),
          ),
        );

      // Titles the recipient already owns take what's given as more copies.
      const partialBooks = partial.length
        ? await tx
            .select()
            .from(books)
            .where(and(eq(books.teacherId, fromId), inArray(books.id, [...new Set(partial.map((copy) => copy.bookId))])))
        : [];
      const isbns = [...moving, ...partialBooks].flatMap((book) => (book.isbn13 ? [book.isbn13] : []));
      const theirs = isbns.length
        ? await tx
            .select({ id: books.id, isbn13: books.isbn13 })
            .from(books)
            .where(and(eq(books.teacherId, toId), inArray(books.isbn13, isbns)))
        : [];
      const joinInto = new Map(theirs.map((book) => [book.isbn13, book.id]));
      let joined = 0;

      /** Moves copies onto the recipient's title, numbered after the copies it already has. */
      const moveCopies = async (copyRows: { id: string }[], targetId: string) => {
        const [{ highest }] = await tx.select({ highest: max(copies.copyNumber) }).from(copies).where(eq(copies.bookId, targetId));
        for (const [index, copy] of copyRows.entries()) {
          await tx
            .update(copies)
            .set({ teacherId: toId, bookId: targetId, copyNumber: (highest ?? 0) + index + 1 })
            .where(eq(copies.id, copy.id));
        }
      };

      const joining = moving.filter((book) => book.isbn13 && joinInto.has(book.isbn13));
      for (const book of joining) {
        const targetId = joinInto.get(book.isbn13)!;
        await moveCopies(
          await tx.select({ id: copies.id }).from(copies).where(eq(copies.bookId, book.id)).orderBy(asc(copies.copyNumber)),
          targetId,
        );
        await tx.update(loans).set({ bookId: targetId }).where(eq(loans.bookId, book.id));
        await tx.delete(books).where(and(eq(books.id, book.id), eq(books.teacherId, fromId)));
        joined++;
      }

      const whole = bookIds.filter((id) => !joining.some((book) => book.id === id));
      if (whole.length > 0) {
        await tx.update(books).set({ teacherId: toId }).where(and(eq(books.teacherId, fromId), inArray(books.id, whole)));
        await tx.update(copies).set({ teacherId: toId }).where(and(eq(copies.teacherId, fromId), inArray(copies.bookId, whole)));
      }

      // Some of a title's copies: onto the recipient's own title, or a new one with the
      // same details. The sender keeps the title and the rest of its copies.
      for (const book of partialBooks) {
        const given = partial.filter((copy) => copy.bookId === book.id);
        let targetId = book.isbn13 ? joinInto.get(book.isbn13) : undefined;
        if (targetId) {
          joined++;
        } else {
          [{ id: targetId }] = await tx
            .insert(books)
            .values({
              teacherId: toId,
              isbn13: book.isbn13,
              title: book.title,
              subtitle: book.subtitle,
              authors: book.authors,
              description: book.description,
              coverUrl: book.coverUrl,
              publisher: book.publisher,
              publishedYear: book.publishedYear,
              pageCount: book.pageCount,
              readingLevel: book.readingLevel,
              tags: book.tags,
              location: book.location,
              notes: book.notes,
              lendable: book.lendable,
              metadataSource: book.metadataSource,
            })
            .returning({ id: books.id });
        }
        await moveCopies(given, targetId);
        // The copies the sender keeps close ranks, as after deleting one.
        await renumberCopies(tx, book.id);
        // Only checkouts going with a student still name these copies; the rest let go above.
        await tx.update(loans).set({ bookId: targetId }).where(inArray(loans.copyId, given.map((copy) => copy.id)));
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
      return {
        status: "accepted" as const,
        fromName,
        classes: classIds.length,
        books: bookIds.length + partialBooks.length,
        joined,
      };
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
 * it can go ahead. `moving.copyIds` are single copies from titles that stay.
 */
async function findProblems(
  db: Database,
  fromId: string,
  /** Null for an offer still waiting on an email: it has no students yet to clash with. */
  toId: string | null,
  classIds: string[],
  moving: Moving,
): Promise<string[]> {
  const problems: string[] = [];
  const { bookIds, copyIds: partialIds } = moving;
  const studentMoves = inList(students.classId, classIds);

  // Books in children's hands, where the child and the copy would end up in different classrooms.
  const open = await db
    .select({
      title: books.title,
      copyNumber: copies.copyNumber,
      bookId: loans.bookId,
      copyId: loans.copyId,
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
    .where(
      and(
        eq(loans.teacherId, fromId),
        isNull(loans.closedAt),
        or(studentMoves, inList(loans.bookId, bookIds), inList(loans.copyId, partialIds)),
      ),
    )
    .orderBy(asc(books.title));
  for (const loan of open) {
    const studentGoes = loan.classId !== null && classIds.includes(loan.classId);
    const copyGoes = (loan.bookId !== null && bookIds.includes(loan.bookId)) || (loan.copyId !== null && partialIds.includes(loan.copyId));
    if (studentGoes === copyGoes) continue;
    const who = `${loan.firstName} ${loan.lastName}`.trim() + (loan.className ? ` (${loan.className})` : "");
    problems.push(
      copyGoes
        ? `${loan.title}, copy ${loan.copyNumber}, is checked out to ${who}, who isn't part of this hand-over. Check it in first.`
        : `${who} has ${loan.title}, copy ${loan.copyNumber}, which isn't part of this hand-over. Check it in first.`,
    );
  }

  // Copies lent to or borrowed from another teacher, or titles asked for.
  if (bookIds.length > 0 || partialIds.length > 0) {
    const lending = await db
      .select({ title: books.title, status: shelfLoans.status, ownerId: shelfLoans.ownerTeacherId })
      .from(shelfLoans)
      .innerJoin(copies, or(eq(copies.id, shelfLoans.copyId), eq(copies.id, shelfLoans.borrowerCopyId)))
      .innerJoin(books, and(eq(books.id, copies.bookId), eq(books.teacherId, copies.teacherId)))
      .where(
        and(
          or(inList(books.id, bookIds), inList(copies.id, partialIds)),
          eq(books.teacherId, fromId),
          or(
            and(eq(shelfLoans.ownerTeacherId, fromId), eq(shelfLoans.status, "active")),
            and(eq(shelfLoans.borrowerTeacherId, fromId), eq(shelfLoans.status, "active")),
          ),
        ),
      );
    for (const loan of lending) {
      problems.push(
        loan.ownerId === fromId
          ? `${loan.title} is lent to another teacher. It has to come back first.`
          : `${loan.title} is borrowed from another teacher. Send it back first.`,
      );
    }
  }
  // A request is for a title, so it only stands in the way when the whole title goes.
  if (bookIds.length > 0) {
    const requested = await db
      .select({ title: books.title })
      .from(shelfLoans)
      .innerJoin(books, and(eq(books.id, shelfLoans.bookId), eq(books.teacherId, shelfLoans.ownerTeacherId)))
      .where(and(eq(shelfLoans.ownerTeacherId, fromId), eq(shelfLoans.status, "requested"), inArray(books.id, bookIds)));
    for (const request of requested) {
      problems.push(`Another teacher has asked to borrow ${request.title}. Answer the request first.`);
    }
  }

  // Student ID numbers the recipient already uses.
  if (classIds.length > 0 && toId) {
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
