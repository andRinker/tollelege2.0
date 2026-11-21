import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, type ChangeField, metadataChanges } from "@/db/schema";
import { type LibraryHealth, libraryHealth } from "@/lib/health";
import { lockedFields, readSources } from "@/lib/provenance";
import { planReconcile, type ReconcileChange, settleSeries } from "@/lib/reconcile";

/**
 * Gives every series and every author in a teacher's library one spelling. A series is joined to
 * another only when `looseSeriesKey` says they are the same, and an author only when `samePerson`
 * does, so this never guesses and applies without asking. Each change is logged in a batch, so
 * `undoReconcile` can put it all back. Returns null when there was nothing to settle.
 */
export async function reconcileLibrary(db: Database, teacherId: string, joinBatch?: string): Promise<{ batchId: string; changed: number } | null> {
  const rows = await db
    .select({ id: books.id, series: books.series, authors: books.authors, fieldSources: books.fieldSources })
    .from(books)
    .where(eq(books.teacherId, teacherId));
  const changes = planReconcile(rows.map(({ fieldSources, ...book }) => ({ ...book, locked: lockedFields(readSources(fieldSources)) })));
  if (changes.length === 0) return null;

  const batchId = joinBatch ?? crypto.randomUUID();
  await db.transaction(async (tx) => {
    for (const change of changes) {
      const where = and(eq(books.id, change.bookId), eq(books.teacherId, teacherId));
      if (change.field === "series") await tx.update(books).set({ series: change.to }).where(where);
      else await tx.update(books).set({ authors: change.to }).where(where);
    }
    await tx.insert(metadataChanges).values(
      changes.map((change: ReconcileChange) => ({
        teacherId,
        batchId,
        bookId: change.bookId,
        field: change.field,
        oldValue: change.from,
        newValue: change.to,
      })),
    );
  });
  return { batchId, changed: new Set(changes.map((change) => change.bookId)).size };
}

/** One field of one book changed by an automatic pass, as logged for undo. */
export type LoggedChange = { bookId: string; field: ChangeField; from: unknown; to: unknown };

/** A value as jsonb: a missing one is JSON null, which the not-null columns accept, not SQL null. */
const jsonValue = (value: unknown) => (value === null || value === undefined ? sql`'null'::jsonb` : value);

/** Records changes under a batch so `undoReconcile` can put them back. */
export async function logChanges(db: Pick<Database, "insert">, teacherId: string, batchId: string, changes: readonly LoggedChange[]): Promise<void> {
  if (changes.length === 0) return;
  await db.insert(metadataChanges).values(
    changes.map((change) => ({ teacherId, batchId, bookId: change.bookId, field: change.field, oldValue: jsonValue(change.from), newValue: jsonValue(change.to) })),
  );
}

/** The latest batch not yet undone, for the "Undo" button, or null. */
export async function lastReconcile(db: Database, teacherId: string): Promise<{ batchId: string; books: number; at: Date } | null> {
  const [latest] = await db
    .select({ batchId: metadataChanges.batchId, at: metadataChanges.createdAt })
    .from(metadataChanges)
    .where(and(eq(metadataChanges.teacherId, teacherId), isNull(metadataChanges.undoneAt)))
    .orderBy(desc(metadataChanges.createdAt))
    .limit(1);
  if (!latest) return null;
  const rows = await db
    .select({ bookId: metadataChanges.bookId })
    .from(metadataChanges)
    .where(and(eq(metadataChanges.teacherId, teacherId), eq(metadataChanges.batchId, latest.batchId), isNull(metadataChanges.undoneAt)));
  return { batchId: latest.batchId, books: new Set(rows.map((row) => row.bookId)).size, at: latest.at };
}

/**
 * Puts a batch back. A field is restored only if the book still holds what the batch gave it,
 * so a book edited since keeps its edit. Returns how many fields were restored and how many
 * were left because the book had changed since.
 */
export async function undoReconcile(db: Database, teacherId: string, batchId: string): Promise<{ restored: number; kept: number }> {
  const rows = await db
    .select()
    .from(metadataChanges)
    .where(and(eq(metadataChanges.teacherId, teacherId), eq(metadataChanges.batchId, batchId), isNull(metadataChanges.undoneAt)));
  if (rows.length === 0) return { restored: 0, kept: 0 };
  const current = new Map(
    (await db
      .select()
      .from(books)
      .where(and(eq(books.teacherId, teacherId), inArray(books.id, rows.map((row) => row.bookId))))).map((book) => [book.id, book]),
  );
  let restored = 0;
  let kept = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const book = current.get(row.bookId);
      const holds = book && JSON.stringify(book[row.field] ?? null) === JSON.stringify(row.newValue ?? null);
      if (!holds) {
        kept += 1;
        continue;
      }
      await tx
        .update(books)
        .set({ [row.field]: row.oldValue })
        .where(and(eq(books.id, row.bookId), eq(books.teacherId, teacherId)));
      restored += 1;
    }
    await tx.update(metadataChanges).set({ undoneAt: new Date() }).where(inArray(metadataChanges.id, rows.map((row) => row.id)));
  });
  return { restored, kept };
}

/** The library's spelling of a series (by `looseSeriesKey`), or the name as given. Used by every write that sets one. */
export async function resolveSeriesName(db: Database, teacherId: string, name: string): Promise<string> {
  const rows = await db.select({ series: books.series, fieldSources: books.fieldSources }).from(books).where(and(eq(books.teacherId, teacherId), isNotNull(books.series)));
  const known = new Map<string, number>();
  const chosen = new Map<string, number>();
  for (const { series, fieldSources } of rows) {
    if (!series) continue;
    known.set(series, (known.get(series) ?? 0) + 1);
    if (readSources(fieldSources).series === "teacher") chosen.set(series, (chosen.get(series) ?? 0) + 1);
  }
  return settleSeries(name, known, chosen);
}

/** How complete and consistent a teacher's library is; see `libraryHealth`. */
export async function getLibraryHealth(db: Database, teacherId: string, readingLevels: boolean): Promise<LibraryHealth> {
  const library = await db
    .select({
      id: books.id,
      isbn13: books.isbn13,
      authors: books.authors,
      description: books.description,
      coverUrl: books.coverUrl,
      publisher: books.publisher,
      publishedYear: books.publishedYear,
      pageCount: books.pageCount,
      readingLevel: books.readingLevel,
      tags: books.tags,
      genreId: books.genreId,
      series: books.series,
    })
    .from(books)
    .where(eq(books.teacherId, teacherId));
  return libraryHealth(library, { readingLevels });
}
