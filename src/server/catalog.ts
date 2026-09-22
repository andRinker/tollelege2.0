import { and, asc, count, desc, eq, ilike, isNotNull, isNull, max, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, type CopyStatus, copies, loans, type MetadataSource, students } from "@/db/schema";
import { normalizeIsbn } from "@/lib/isbn";
import { ConflictError, isUniqueViolation, NotFoundError } from "./errors";
import type { BookMetadata } from "./isbn-lookup";
import { assertNotInShelfLoan } from "./lending";

export type BookDetailsInput = {
  isbn13: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  coverUrl: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  readingLevel: string | null;
  tags: string[];
  location: string | null;
  notes: string | null;
  metadataSource: MetadataSource;
};

export const MAX_TAGS = 12;

/** Trims, de-duplicates (case-insensitively), and caps tags, keeping the first spelling. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, 30);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result.slice(0, MAX_TAGS);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function requireBook(db: Database, teacherId: string, bookId: string, lock = false) {
  const query = db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)));
  const [book] = lock ? await query.for("update") : await query;
  if (!book) throw new NotFoundError("That book isn't in your library.");
  return book;
}

export async function createBook(
  db: Database,
  teacherId: string,
  input: BookDetailsInput,
  copyCount = 1,
): Promise<{ bookId: string; copyIds: string[] }> {
  try {
    return await db.transaction(async (tx) => {
      const [book] = await tx
        .insert(books)
        .values({ ...input, teacherId, tags: normalizeTags(input.tags) })
        .returning({ id: books.id });
      const inserted = await tx
        .insert(copies)
        .values(Array.from({ length: Math.max(1, copyCount) }, (_, i) => ({ teacherId, bookId: book.id, copyNumber: i + 1 })))
        .returning({ id: copies.id });
      return { bookId: book.id, copyIds: inserted.map((copy) => copy.id) };
    });
  } catch (error) {
    if (isUniqueViolation(error, "books_teacher_isbn_unique")) {
      throw new ConflictError("A book with that ISBN is already in your library.");
    }
    throw error;
  }
}

export async function addCopies(
  db: Database,
  teacherId: string,
  bookId: string,
  howMany = 1,
): Promise<{ copyIds: string[]; totalCopies: number }> {
  return db.transaction(async (tx) => {
    await requireBook(tx, teacherId, bookId, true);
    const [{ highest }] = await tx.select({ highest: max(copies.copyNumber) }).from(copies).where(eq(copies.bookId, bookId));
    const start = (highest ?? 0) + 1;
    const inserted = await tx
      .insert(copies)
      .values(Array.from({ length: Math.max(1, howMany) }, (_, i) => ({ teacherId, bookId, copyNumber: start + i })))
      .returning({ id: copies.id });
    const [{ total }] = await tx
      .select({ total: count() })
      .from(copies)
      .where(and(eq(copies.bookId, bookId), eq(copies.status, "in_circulation")));
    return { copyIds: inserted.map((copy) => copy.id), totalCopies: total };
  });
}

export async function findBookByIsbn(db: Database, teacherId: string, isbn13: string) {
  // Counted with a join rather than a correlated subquery: drizzle renders column
  // references inside a `sql` template unqualified, so `copies.book_id = books.id`
  // came out as `book_id = id` and silently compared a copy against itself.
  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      authors: books.authors,
      coverUrl: books.coverUrl,
      totalCopies: count(copies.id),
    })
    .from(books)
    .leftJoin(copies, and(eq(copies.bookId, books.id), eq(copies.status, "in_circulation")))
    .where(and(eq(books.teacherId, teacherId), eq(books.isbn13, isbn13)))
    .groupBy(books.id)
    .limit(1);
  return book ?? null;
}

export type QuickAddResult = {
  outcome: "created" | "copy_added";
  bookId: string;
  copyId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  totalCopies: number;
};

/** Rapid scan: adds a copy if the teacher owns the ISBN, otherwise creates the book from metadata. */
export async function quickAddByIsbn(
  db: Database,
  teacherId: string,
  isbn13: string,
  metadata: BookMetadata,
): Promise<QuickAddResult> {
  const existing = await findBookByIsbn(db, teacherId, isbn13);
  if (existing) {
    const { copyIds, totalCopies } = await addCopies(db, teacherId, existing.id);
    return { outcome: "copy_added", bookId: existing.id, copyId: copyIds[0], title: existing.title, authors: existing.authors, coverUrl: existing.coverUrl, totalCopies };
  }
  try {
    const { bookId, copyIds } = await createBook(db, teacherId, bookInputFromMetadata(metadata));
    return { outcome: "created", bookId, copyId: copyIds[0], title: metadata.title, authors: metadata.authors, coverUrl: metadata.coverUrl, totalCopies: 1 };
  } catch (error) {
    // Another scan of the same ISBN created the book first; count this one as a copy.
    if (error instanceof ConflictError) return quickAddByIsbn(db, teacherId, isbn13, metadata);
    throw error;
  }
}

export function bookInputFromMetadata(metadata: BookMetadata): BookDetailsInput {
  return {
    isbn13: metadata.isbn13,
    title: metadata.title,
    subtitle: metadata.subtitle,
    authors: metadata.authors,
    description: metadata.description,
    coverUrl: metadata.coverUrl,
    publisher: metadata.publisher,
    publishedYear: metadata.publishedYear,
    pageCount: metadata.pageCount,
    readingLevel: null,
    tags: [],
    location: null,
    notes: null,
    metadataSource: metadata.source,
  };
}

/** Undoes a rapid-scan add: removes the copy, and the book too if that was its only copy. */
export async function undoQuickAdd(db: Database, teacherId: string, copyId: string): Promise<"copy_removed" | "book_removed"> {
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .select({ id: copies.id, bookId: copies.bookId })
      .from(copies)
      .where(and(eq(copies.id, copyId), eq(copies.teacherId, teacherId)))
      .for("update");
    if (!copy) throw new NotFoundError("That copy was already removed.");
    const [{ loanCount }] = await tx.select({ loanCount: count() }).from(loans).where(eq(loans.copyId, copyId));
    if (loanCount > 0) throw new ConflictError("That copy has already been checked out, so it can't be undone.");

    await tx.delete(copies).where(eq(copies.id, copyId));
    const [{ remaining }] = await tx.select({ remaining: count() }).from(copies).where(eq(copies.bookId, copy.bookId));
    if (remaining > 0) return "copy_removed";
    await tx.delete(books).where(and(eq(books.id, copy.bookId), eq(books.teacherId, teacherId)));
    return "book_removed";
  });
}

export async function updateBookDetails(db: Database, teacherId: string, bookId: string, input: Partial<BookDetailsInput>) {
  const values = input.tags ? { ...input, tags: normalizeTags(input.tags) } : input;
  try {
    const updated = await db
      .update(books)
      .set(values)
      .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)))
      .returning({ id: books.id });
    if (updated.length === 0) throw new NotFoundError("That book isn't in your library.");
  } catch (error) {
    if (isUniqueViolation(error, "books_teacher_isbn_unique")) {
      throw new ConflictError("Another book in your library already has that ISBN.");
    }
    throw error;
  }
}

export async function deleteBook(db: Database, teacherId: string, bookId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireBook(tx, teacherId, bookId, true);
    await assertNotInShelfLoan(tx, teacherId, { bookId });
    const [{ loanCount }] = await tx
      .select({ loanCount: count() })
      .from(loans)
      .innerJoin(copies, eq(copies.id, loans.copyId))
      .where(eq(copies.bookId, bookId));
    if (loanCount > 0) {
      throw new ConflictError("This book has checkout history, so it can't be deleted. Withdraw its copies instead.");
    }
    await tx.delete(books).where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)));
  });
}

/** Offers a title to connected teachers, or holds it back. */
export async function setBookLendable(
  db: Database,
  teacherId: string,
  bookId: string,
  lendable: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await requireBook(tx, teacherId, bookId, true);
    if (!lendable) await assertNotInShelfLoan(tx, teacherId, { bookId });
    await tx
      .update(books)
      .set({ lendable })
      .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)));
  });
}

async function requireCopy(db: Database, teacherId: string, copyId: string) {
  const [copy] = await db
    .select({ id: copies.id, bookId: copies.bookId, status: copies.status })
    .from(copies)
    .where(and(eq(copies.id, copyId), eq(copies.teacherId, teacherId)))
    .for("update");
  if (!copy) throw new NotFoundError("That copy isn't in your library.");
  return copy;
}

export async function setCopyStatus(db: Database, teacherId: string, copyId: string, status: CopyStatus): Promise<void> {
  await db.transaction(async (tx) => {
    await requireCopy(tx, teacherId, copyId);
    await assertNotInShelfLoan(tx, teacherId, { copyId });
    if (status !== "in_circulation") {
      const [open] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.copyId, copyId), isNull(loans.closedAt))).limit(1);
      if (open) throw new ConflictError("This copy is checked out. Check it in or mark it lost from Check in first.");
    }
    await tx.update(copies).set({ status }).where(eq(copies.id, copyId));
  });
}

export async function deleteCopy(db: Database, teacherId: string, copyId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const copy = await requireCopy(tx, teacherId, copyId);
    await assertNotInShelfLoan(tx, teacherId, { copyId });
    const [{ loanCount }] = await tx.select({ loanCount: count() }).from(loans).where(eq(loans.copyId, copyId));
    if (loanCount > 0) throw new ConflictError("This copy has checkout history. Withdraw it instead of deleting it.");
    const [{ copyCount }] = await tx.select({ copyCount: count() }).from(copies).where(eq(copies.bookId, copy.bookId));
    if (copyCount <= 1) throw new ConflictError("This is the book's only copy. Delete the book instead.");
    await tx.delete(copies).where(eq(copies.id, copyId));
  });
}

export type Availability = "all" | "available" | "out";
export type BookSort = "title" | "author" | "recent";

export type BookListFilters = {
  query?: string;
  availability?: Availability;
  tag?: string;
  readingLevel?: string;
  location?: string;
  sort?: BookSort;
  page?: number;
  pageSize?: number;
};

export type BookListItem = {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  isbn13: string | null;
  readingLevel: string | null;
  tags: string[];
  location: string | null;
  totalCopies: number;
  availableCopies: number;
};

// Titles sort without a leading "The", "A", or "An", as libraries shelve them.
const sortableTitle = sql`regexp_replace(lower(${books.title}), '^(the|a|an)\\s+', '')`;

export async function listBooks(db: Database, teacherId: string, filters: BookListFilters = {}) {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 48, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);

  const copyCounts = db
    .select({
      bookId: copies.bookId,
      total: sql<number>`count(*) filter (where ${copies.status} = 'in_circulation')`.mapWith(Number).as("total"),
      available: sql<number>`count(*) filter (where ${copies.status} = 'in_circulation' and ${loans.id} is null)`
        .mapWith(Number)
        .as("available"),
    })
    .from(copies)
    .leftJoin(loans, and(eq(loans.copyId, copies.id), isNull(loans.closedAt)))
    .where(eq(copies.teacherId, teacherId))
    .groupBy(copies.bookId)
    .as("copy_counts");

  const conditions: SQL[] = [eq(books.teacherId, teacherId)];
  const query = filters.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    const isbn = normalizeIsbn(query);
    conditions.push(
      or(
        ilike(books.title, pattern),
        ilike(books.subtitle, pattern),
        sql`array_to_string(${books.authors}, ' ') ilike ${pattern}`,
        sql`array_to_string(${books.tags}, ' ') ilike ${pattern}`,
        isbn ? eq(books.isbn13, isbn) : undefined,
      ) as SQL,
    );
  }
  if (filters.tag) conditions.push(sql`${filters.tag} = any(${books.tags})`);
  if (filters.readingLevel) conditions.push(eq(books.readingLevel, filters.readingLevel));
  if (filters.location) conditions.push(eq(books.location, filters.location));
  if (filters.availability === "available") conditions.push(sql`coalesce(${copyCounts.available}, 0) > 0`);
  if (filters.availability === "out") conditions.push(sql`coalesce(${copyCounts.total}, 0) > coalesce(${copyCounts.available}, 0)`);

  const where = and(...conditions);
  const orderBy =
    filters.sort === "recent"
      ? [desc(books.createdAt), asc(sortableTitle)]
      : filters.sort === "author"
        ? // By the first author's last name.
          [asc(sql`lower(regexp_replace(coalesce(${books.authors}[1], ''), '^.*\\s', ''))`), asc(sortableTitle)]
        : [asc(sortableTitle)];

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(books).leftJoin(copyCounts, eq(copyCounts.bookId, books.id)).where(where),
    db
      .select({
        id: books.id,
        title: books.title,
        subtitle: books.subtitle,
        authors: books.authors,
        coverUrl: books.coverUrl,
        isbn13: books.isbn13,
        readingLevel: books.readingLevel,
        tags: books.tags,
        location: books.location,
        totalCopies: sql<number>`coalesce(${copyCounts.total}, 0)`.mapWith(Number),
        availableCopies: sql<number>`coalesce(${copyCounts.available}, 0)`.mapWith(Number),
      })
      .from(books)
      .leftJoin(copyCounts, eq(copyCounts.bookId, books.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return { items: rows as BookListItem[], total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function catalogSummary(db: Database, teacherId: string) {
  const [[titles], [copyTotals], tagRows, levelRows, locationRows] = await Promise.all([
    db.select({ count: count() }).from(books).where(eq(books.teacherId, teacherId)),
    db
      .select({ count: count() })
      .from(copies)
      .where(and(eq(copies.teacherId, teacherId), eq(copies.status, "in_circulation"))),
    db
      .selectDistinct({ tag: sql<string>`unnest(${books.tags})`.as("tag") })
      .from(books)
      .where(eq(books.teacherId, teacherId))
      .orderBy(sql`1`),
    db
      .selectDistinct({ value: books.readingLevel })
      .from(books)
      .where(and(eq(books.teacherId, teacherId), isNotNull(books.readingLevel)))
      .orderBy(books.readingLevel),
    db
      .selectDistinct({ value: books.location })
      .from(books)
      .where(and(eq(books.teacherId, teacherId), isNotNull(books.location)))
      .orderBy(books.location),
  ]);
  return {
    titles: titles.count,
    copies: copyTotals.count,
    tags: tagRows.map((row) => row.tag),
    readingLevels: levelRows.map((row) => row.value as string),
    locations: locationRows.map((row) => row.value as string),
  };
}

export async function getBookDetail(db: Database, teacherId: string, bookId: string) {
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)));
  if (!book) throw new NotFoundError("That book isn't in your library.");

  const [copyRows, history] = await Promise.all([
    db
      .select({
        id: copies.id,
        copyNumber: copies.copyNumber,
        status: copies.status,
        conditionNote: copies.conditionNote,
        loanId: loans.id,
        studentId: students.id,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        checkedOutAt: loans.checkedOutAt,
        dueOn: loans.dueOn,
        loanCount: sql<number>`(select count(*) from ${loans} as l where l.copy_id = ${copies.id})`.mapWith(Number),
      })
      .from(copies)
      .leftJoin(loans, and(eq(loans.copyId, copies.id), isNull(loans.closedAt)))
      .leftJoin(students, eq(students.id, loans.studentId))
      .where(and(eq(copies.bookId, bookId), eq(copies.teacherId, teacherId)))
      .orderBy(copies.copyNumber),
    db
      .select({
        loanId: loans.id,
        copyNumber: copies.copyNumber,
        studentId: students.id,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        checkedOutAt: loans.checkedOutAt,
        dueOn: loans.dueOn,
        closedAt: loans.closedAt,
        closeReason: loans.closeReason,
      })
      .from(loans)
      .innerJoin(copies, eq(copies.id, loans.copyId))
      .innerJoin(students, eq(students.id, loans.studentId))
      .where(and(eq(copies.bookId, bookId), eq(loans.teacherId, teacherId)))
      .orderBy(desc(loans.checkedOutAt))
      .limit(50),
  ]);

  return { book, copies: copyRows, history };
}

export type BookDetail = Awaited<ReturnType<typeof getBookDetail>>;

export type BookIdentity = {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  copies: number;
};

/**
 * Just enough of the catalogue to recognise a book the teacher already has. Shelf scans
 * match against this so a second printing of an owned title adds a copy instead of a
 * duplicate row. Deliberately lean: a classroom library is hundreds of books, not millions.
 */
export async function listBookIdentities(db: Database, teacherId: string): Promise<BookIdentity[]> {
  return db
    .select({
      id: books.id,
      title: books.title,
      authors: books.authors,
      isbn13: books.isbn13,
      copies: count(copies.id),
    })
    .from(books)
    .leftJoin(copies, and(eq(copies.bookId, books.id), eq(copies.status, "in_circulation")))
    .where(eq(books.teacherId, teacherId))
    .groupBy(books.id);
}
