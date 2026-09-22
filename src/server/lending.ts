import { and, asc, count, desc, eq, ilike, inArray, isNull, notExists, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { books, copies, loans, shelfLoans, user } from "@/db/schema";
import { requireConnection } from "./connections";
import { ConflictError, isUniqueViolation, NotFoundError } from "./errors";

const SHELF_PAGE_SIZE = 24;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * A copy is free to lend when it is in circulation, no student has it, and it isn't
 * itself a book borrowed from someone else — nobody sub-lends another teacher's book.
 */
function freeToLend(db: Database): SQL {
  const openLoan = alias(loans, "lend_open_loan");
  const borrowed = alias(shelfLoans, "lend_borrowed");
  return and(
    eq(copies.status, "in_circulation"),
    notExists(
      db
        .select({ one: sql`1` })
        .from(openLoan)
        .where(and(eq(openLoan.copyId, copies.id), isNull(openLoan.closedAt))),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(borrowed)
        .where(and(eq(borrowed.borrowerCopyId, copies.id), eq(borrowed.status, "active"))),
    ),
  ) as SQL;
}

export type ShelfBook = {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  readingLevel: string | null;
  tags: string[];
  availableCopies: number;
  /** Where this viewer already stands with the title. */
  standing: "none" | "requested" | "borrowed";
};

export type ShelfPage = {
  items: ShelfBook[];
  page: number;
  pageCount: number;
  total: number;
};

/** The titles a connected teacher offers, with how many copies are free right now. */
export async function browseShelf(
  db: Database,
  viewerTeacherId: string,
  ownerTeacherId: string,
  options: { query?: string; page?: number } = {},
): Promise<ShelfPage> {
  await requireConnection(db, viewerTeacherId, ownerTeacherId);

  const conditions: SQL[] = [eq(books.teacherId, ownerTeacherId), eq(books.lendable, true)];
  if (options.query?.trim()) {
    const pattern = `%${escapeLike(options.query.trim())}%`;
    conditions.push(
      or(ilike(books.title, pattern), sql`array_to_string(${books.authors}, ' ') ilike ${pattern}`) as SQL,
    );
  }
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(books).where(where);
  const pageCount = Math.max(1, Math.ceil(total / SHELF_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      subtitle: books.subtitle,
      authors: books.authors,
      coverUrl: books.coverUrl,
      readingLevel: books.readingLevel,
      tags: books.tags,
      availableCopies: count(copies.id),
    })
    .from(books)
    .leftJoin(copies, and(eq(copies.bookId, books.id), freeToLend(db)))
    .where(where)
    .groupBy(books.id)
    .orderBy(asc(sql`lower(${books.title})`))
    .limit(SHELF_PAGE_SIZE)
    .offset((page - 1) * SHELF_PAGE_SIZE);

  const standings = await db
    .select({ bookId: shelfLoans.bookId, status: shelfLoans.status })
    .from(shelfLoans)
    .where(
      and(
        eq(shelfLoans.borrowerTeacherId, viewerTeacherId),
        eq(shelfLoans.ownerTeacherId, ownerTeacherId),
        inArray(shelfLoans.status, ["requested", "active"]),
      ),
    );
  const byBook = new Map(standings.map((row) => [row.bookId, row.status]));

  return {
    items: rows.map((row) => ({
      ...row,
      standing: byBook.get(row.id) === "active" ? "borrowed" : byBook.has(row.id) ? "requested" : "none",
    })),
    page,
    pageCount,
    total,
  };
}

/** Asks a connected teacher for one of their titles. A copy is picked when they say yes. */
export async function requestShelfLoan(
  db: Database,
  borrowerTeacherId: string,
  input: { ownerTeacherId: string; bookId: string; message: string | null },
): Promise<{ shelfLoanId: string; title: string }> {
  await requireConnection(db, borrowerTeacherId, input.ownerTeacherId);

  const [book] = await db
    .select({ id: books.id, title: books.title, lendable: books.lendable })
    .from(books)
    .where(and(eq(books.id, input.bookId), eq(books.teacherId, input.ownerTeacherId)));
  if (!book) throw new NotFoundError("That book isn't on their shelves.");
  if (!book.lendable) throw new ConflictError(`${book.title} isn't offered for lending.`);

  const [active] = await db
    .select({ id: shelfLoans.id })
    .from(shelfLoans)
    .where(
      and(
        eq(shelfLoans.bookId, book.id),
        eq(shelfLoans.borrowerTeacherId, borrowerTeacherId),
        eq(shelfLoans.status, "active"),
      ),
    )
    .limit(1);
  if (active) throw new ConflictError(`You already have ${book.title} on loan.`);

  try {
    const [row] = await db
      .insert(shelfLoans)
      .values({
        ownerTeacherId: input.ownerTeacherId,
        borrowerTeacherId,
        bookId: book.id,
        message: input.message,
      })
      .returning({ id: shelfLoans.id });
    return { shelfLoanId: row.id, title: book.title };
  } catch (error) {
    if (isUniqueViolation(error, "shelf_loans_one_request_per_title")) {
      throw new ConflictError(`You've already asked for ${book.title}.`);
    }
    throw error;
  }
}

/**
 * Hands a copy over. The owner's copy is marked `lent_out` so it drops out of their own
 * checkout screens, and a stand-in copy appears on the borrower's shelf for their students
 * to check out — folded into the borrower's existing title when they already own the ISBN.
 */
export async function approveShelfLoan(
  db: Database,
  ownerTeacherId: string,
  shelfLoanId: string,
  input: { dueOn: string | null },
): Promise<{ title: string; copyNumber: number; borrowerName: string }> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select({
        id: shelfLoans.id,
        bookId: shelfLoans.bookId,
        borrowerTeacherId: shelfLoans.borrowerTeacherId,
      })
      .from(shelfLoans)
      .where(
        and(
          eq(shelfLoans.id, shelfLoanId),
          eq(shelfLoans.ownerTeacherId, ownerTeacherId),
          eq(shelfLoans.status, "requested"),
        ),
      )
      .for("update");
    if (!request) throw new NotFoundError("That request is no longer waiting for an answer.");

    await requireConnection(tx, ownerTeacherId, request.borrowerTeacherId);

    const [book] = await tx
      .select({
        id: books.id,
        isbn13: books.isbn13,
        title: books.title,
        subtitle: books.subtitle,
        authors: books.authors,
        description: books.description,
        coverUrl: books.coverUrl,
        publisher: books.publisher,
        publishedYear: books.publishedYear,
        pageCount: books.pageCount,
        readingLevel: books.readingLevel,
        tags: books.tags,
        metadataSource: books.metadataSource,
        lendable: books.lendable,
      })
      .from(books)
      .where(and(eq(books.id, request.bookId), eq(books.teacherId, ownerTeacherId)));
    if (!book) throw new NotFoundError("That book is no longer in your library.");
    if (!book.lendable) throw new ConflictError(`${book.title} is no longer offered for lending.`);

    const [copy] = await tx
      .select({ id: copies.id, copyNumber: copies.copyNumber })
      .from(copies)
      .where(and(eq(copies.bookId, book.id), eq(copies.teacherId, ownerTeacherId), freeToLend(tx)))
      .orderBy(asc(copies.copyNumber))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!copy) throw new ConflictError(`Every copy of ${book.title} is out right now.`);

    const [borrower] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, request.borrowerTeacherId));

    await tx.update(copies).set({ status: "lent_out" }).where(eq(copies.id, copy.id));

    // Fold into the borrower's own title when they already have this ISBN, the same way a
    // second printing on a shelf photo becomes another copy rather than a duplicate entry.
    let borrowerBookId: string | undefined;
    if (book.isbn13) {
      const [owned] = await tx
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.teacherId, request.borrowerTeacherId), eq(books.isbn13, book.isbn13)));
      borrowerBookId = owned?.id;
    }
    if (!borrowerBookId) {
      const [created] = await tx
        .insert(books)
        .values({
          teacherId: request.borrowerTeacherId,
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
          metadataSource: book.metadataSource,
          // A borrowed book is never offered on to a third teacher.
          lendable: false,
        })
        .returning({ id: books.id });
      borrowerBookId = created.id;
    }

    const [{ highest }] = await tx
      .select({ highest: sql<number | null>`max(${copies.copyNumber})` })
      .from(copies)
      .where(eq(copies.bookId, borrowerBookId));
    const [shadow] = await tx
      .insert(copies)
      .values({
        teacherId: request.borrowerTeacherId,
        bookId: borrowerBookId,
        copyNumber: (highest ?? 0) + 1,
      })
      .returning({ id: copies.id });

    await tx
      .update(shelfLoans)
      .set({
        status: "active",
        copyId: copy.id,
        borrowerCopyId: shadow.id,
        dueOn: input.dueOn,
        respondedAt: new Date(),
      })
      .where(eq(shelfLoans.id, shelfLoanId));

    return { title: book.title, copyNumber: copy.copyNumber, borrowerName: borrower?.name ?? "them" };
  });
}

export async function declineShelfLoan(db: Database, ownerTeacherId: string, shelfLoanId: string): Promise<void> {
  const [row] = await db
    .update(shelfLoans)
    .set({ status: "declined", respondedAt: new Date() })
    .where(
      and(
        eq(shelfLoans.id, shelfLoanId),
        eq(shelfLoans.ownerTeacherId, ownerTeacherId),
        eq(shelfLoans.status, "requested"),
      ),
    )
    .returning({ id: shelfLoans.id });
  if (!row) throw new NotFoundError("That request is no longer waiting for an answer.");
}

export async function cancelShelfLoanRequest(
  db: Database,
  borrowerTeacherId: string,
  shelfLoanId: string,
): Promise<void> {
  const [row] = await db
    .update(shelfLoans)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(shelfLoans.id, shelfLoanId),
        eq(shelfLoans.borrowerTeacherId, borrowerTeacherId),
        eq(shelfLoans.status, "requested"),
      ),
    )
    .returning({ id: shelfLoans.id });
  if (!row) throw new NotFoundError("That request has already been answered.");
}

/**
 * Sends the book home. Either teacher can record it, since the handover is physical.
 * The stand-in copy leaves the borrower's shelf, but is withdrawn rather than deleted
 * when their students have read it, so their checkout history survives the return.
 */
export async function returnShelfLoan(
  db: Database,
  teacherId: string,
  shelfLoanId: string,
): Promise<{ title: string }> {
  return db.transaction(async (tx) => {
    const [loan] = await tx
      .select({
        id: shelfLoans.id,
        copyId: shelfLoans.copyId,
        borrowerCopyId: shelfLoans.borrowerCopyId,
        ownerTeacherId: shelfLoans.ownerTeacherId,
        title: books.title,
      })
      .from(shelfLoans)
      .innerJoin(books, eq(books.id, shelfLoans.bookId))
      .where(
        and(
          eq(shelfLoans.id, shelfLoanId),
          eq(shelfLoans.status, "active"),
          or(eq(shelfLoans.ownerTeacherId, teacherId), eq(shelfLoans.borrowerTeacherId, teacherId)),
        ),
      )
      .for("update", { of: shelfLoans });
    if (!loan) throw new NotFoundError("That loan is already closed.");
    // `shelf_loans_active_has_copies` guarantees both are set while the loan is active.
    const borrowerCopyId = loan.borrowerCopyId as string;
    const ownerCopyId = loan.copyId as string;

    const [student] = await tx
      .select({ id: loans.id })
      .from(loans)
      .where(and(eq(loans.copyId, borrowerCopyId), isNull(loans.closedAt)))
      .limit(1);
    if (student) {
      throw new ConflictError(`${loan.title} is checked out to a student. Check it in before sending it back.`);
    }

    const [shadow] = await tx
      .select({ bookId: copies.bookId })
      .from(copies)
      .where(eq(copies.id, borrowerCopyId));

    // Clear the reference before the copy goes, or the foreign key takes this row with it.
    await tx
      .update(shelfLoans)
      .set({ status: "returned", returnedAt: new Date(), borrowerCopyId: null })
      .where(eq(shelfLoans.id, shelfLoanId));

    const [{ history }] = await tx
      .select({ history: count() })
      .from(loans)
      .where(eq(loans.copyId, borrowerCopyId));
    if (history > 0) {
      await tx.update(copies).set({ status: "withdrawn" }).where(eq(copies.id, borrowerCopyId));
    } else {
      await tx.delete(copies).where(eq(copies.id, borrowerCopyId));
      if (shadow) {
        const [{ remaining }] = await tx
          .select({ remaining: count() })
          .from(copies)
          .where(eq(copies.bookId, shadow.bookId));
        if (remaining === 0) await tx.delete(books).where(eq(books.id, shadow.bookId));
      }
    }

    await tx
      .update(copies)
      .set({ status: "in_circulation" })
      .where(and(eq(copies.id, ownerCopyId), eq(copies.teacherId, loan.ownerTeacherId)));

    return { title: loan.title };
  });
}

export type ShelfLoanRequest = {
  id: string;
  bookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  peerId: string;
  peerName: string;
  message: string | null;
  requestedAt: Date;
};

export type ActiveShelfLoan = {
  id: string;
  bookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  peerId: string;
  peerName: string;
  dueOn: string | null;
  since: Date;
  overdue: boolean;
};

export type LendingView = {
  incoming: ShelfLoanRequest[];
  outgoing: ShelfLoanRequest[];
  lentOut: ActiveShelfLoan[];
  borrowed: ActiveShelfLoan[];
};

/** Everything in flight for this teacher, in both directions. */
export async function listShelfLoans(db: Database, teacherId: string, today: string): Promise<LendingView> {
  const owner = alias(user, "loan_owner");
  const borrower = alias(user, "loan_borrower");

  const rows = await db
    .select({
      id: shelfLoans.id,
      status: shelfLoans.status,
      bookId: shelfLoans.bookId,
      title: books.title,
      authors: books.authors,
      coverUrl: books.coverUrl,
      message: shelfLoans.message,
      dueOn: shelfLoans.dueOn,
      requestedAt: shelfLoans.requestedAt,
      respondedAt: shelfLoans.respondedAt,
      ownerId: owner.id,
      ownerName: owner.name,
      borrowerId: borrower.id,
      borrowerName: borrower.name,
    })
    .from(shelfLoans)
    .innerJoin(books, eq(books.id, shelfLoans.bookId))
    .innerJoin(owner, eq(owner.id, shelfLoans.ownerTeacherId))
    .innerJoin(borrower, eq(borrower.id, shelfLoans.borrowerTeacherId))
    .where(
      and(
        or(eq(shelfLoans.ownerTeacherId, teacherId), eq(shelfLoans.borrowerTeacherId, teacherId)),
        inArray(shelfLoans.status, ["requested", "active"]),
      ),
    )
    .orderBy(desc(shelfLoans.requestedAt));

  const view: LendingView = { incoming: [], outgoing: [], lentOut: [], borrowed: [] };
  for (const row of rows) {
    const isOwner = row.ownerId === teacherId;
    const peer = isOwner
      ? { peerId: row.borrowerId, peerName: row.borrowerName }
      : { peerId: row.ownerId, peerName: row.ownerName };
    const book = { bookId: row.bookId, title: row.title, authors: row.authors, coverUrl: row.coverUrl };

    if (row.status === "requested") {
      const request = { id: row.id, ...book, ...peer, message: row.message, requestedAt: row.requestedAt };
      if (isOwner) view.incoming.push(request);
      else view.outgoing.push(request);
    } else {
      const active = {
        id: row.id,
        ...book,
        ...peer,
        dueOn: row.dueOn,
        since: row.respondedAt ?? row.requestedAt,
        overdue: Boolean(row.dueOn && row.dueOn < today),
      };
      if (isOwner) view.lentOut.push(active);
      else view.borrowed.push(active);
    }
  }
  return view;
}

/** Counts for the dashboard and the navigation badge. */
export async function lendingSummary(db: Database, teacherId: string) {
  const [row] = await db
    .select({
      incoming: sql<number>`count(*) filter (where ${shelfLoans.status} = 'requested' and ${shelfLoans.ownerTeacherId} = ${teacherId})`.mapWith(Number),
      lentOut: sql<number>`count(*) filter (where ${shelfLoans.status} = 'active' and ${shelfLoans.ownerTeacherId} = ${teacherId})`.mapWith(Number),
      borrowed: sql<number>`count(*) filter (where ${shelfLoans.status} = 'active' and ${shelfLoans.borrowerTeacherId} = ${teacherId})`.mapWith(Number),
    })
    .from(shelfLoans)
    .where(or(eq(shelfLoans.ownerTeacherId, teacherId), eq(shelfLoans.borrowerTeacherId, teacherId)));
  return row ?? { incoming: 0, lentOut: 0, borrowed: 0 };
}

/**
 * How a copy in this teacher's own library relates to the lending library: borrowed from
 * someone else, or out with someone else. Keyed by copy ID.
 */
export type CopyLendingState =
  | { kind: "borrowed"; shelfLoanId: string; peerName: string; dueOn: string | null }
  | { kind: "lent_out"; shelfLoanId: string; peerName: string; dueOn: string | null };

export async function copyLendingStates(
  db: Database,
  teacherId: string,
  bookId: string,
): Promise<Map<string, CopyLendingState>> {
  const states = new Map<string, CopyLendingState>();
  const peer = alias(user, "lending_peer");
  const active = eq(shelfLoans.status, "active");

  const lentOut = await db
    .select({ id: shelfLoans.id, copyId: copies.id, dueOn: shelfLoans.dueOn, peerName: peer.name })
    .from(shelfLoans)
    .innerJoin(peer, eq(peer.id, shelfLoans.borrowerTeacherId))
    .innerJoin(copies, eq(copies.id, shelfLoans.copyId))
    .where(and(active, eq(shelfLoans.ownerTeacherId, teacherId), eq(copies.bookId, bookId)));
  for (const row of lentOut) {
    states.set(row.copyId, { kind: "lent_out", shelfLoanId: row.id, peerName: row.peerName, dueOn: row.dueOn });
  }

  const borrowed = await db
    .select({ id: shelfLoans.id, copyId: copies.id, dueOn: shelfLoans.dueOn, peerName: peer.name })
    .from(shelfLoans)
    .innerJoin(peer, eq(peer.id, shelfLoans.ownerTeacherId))
    .innerJoin(copies, eq(copies.id, shelfLoans.borrowerCopyId))
    .where(and(active, eq(shelfLoans.borrowerTeacherId, teacherId), eq(copies.bookId, bookId)));
  for (const row of borrowed) {
    states.set(row.copyId, { kind: "borrowed", shelfLoanId: row.id, peerName: row.peerName, dueOn: row.dueOn });
  }

  return states;
}

/** Blocks catalogue edits that would pull a book out from under an active shelf loan. */
export async function assertNotInShelfLoan(
  db: Database,
  teacherId: string,
  target: { bookId?: string; copyId?: string },
): Promise<void> {
  const active = eq(shelfLoans.status, "active");
  const matches = target.copyId ? eq(copies.id, target.copyId) : eq(copies.bookId, target.bookId as string);

  const [lentOut] = await db
    .select({ id: shelfLoans.id })
    .from(shelfLoans)
    .innerJoin(copies, eq(copies.id, shelfLoans.copyId))
    .where(and(active, eq(shelfLoans.ownerTeacherId, teacherId), matches))
    .limit(1);
  if (lentOut) throw new ConflictError("This is out on loan to another teacher. Mark it returned first.");

  const [borrowed] = await db
    .select({ id: shelfLoans.id })
    .from(shelfLoans)
    .innerJoin(copies, eq(copies.id, shelfLoans.borrowerCopyId))
    .where(and(active, eq(shelfLoans.borrowerTeacherId, teacherId), matches))
    .limit(1);
  if (borrowed) throw new ConflictError("This is borrowed from another teacher. Send it back first.");
}
