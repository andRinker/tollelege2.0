import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, metadataChanges } from "@/db/schema";
import { planReconcile, type ReconcileChange, settleSeries } from "@/lib/reconcile";

/**
 * Gives every series and every author in a teacher's library one spelling. A series is joined to
 * another only when `looseSeriesKey` says they are the same, and an author only when `samePerson`
 * does, so this never guesses and applies without asking. Each change is logged in a batch, so
 * `undoReconcile` can put it all back. Returns null when there was nothing to settle.
 */
export async function reconcileLibrary(db: Database, teacherId: string): Promise<{ batchId: string; changed: number } | null> {
  const library = await db.select({ id: books.id, series: books.series, authors: books.authors }).from(books).where(eq(books.teacherId, teacherId));
  const changes = planReconcile(library);
  if (changes.length === 0) return null;

  const batchId = crypto.randomUUID();
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
      .select({ id: books.id, series: books.series, authors: books.authors })
      .from(books)
      .where(and(eq(books.teacherId, teacherId), inArray(books.id, rows.map((row) => row.bookId))))).map((book) => [book.id, book]),
  );
  let restored = 0;
  let kept = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const book = current.get(row.bookId);
      const holds = book && (row.field === "series" ? book.series === row.newValue : JSON.stringify(book.authors) === JSON.stringify(row.newValue));
      if (!holds) {
        kept += 1;
        continue;
      }
      const where = and(eq(books.id, row.bookId), eq(books.teacherId, teacherId));
      if (row.field === "series") await tx.update(books).set({ series: row.oldValue as string }).where(where);
      else await tx.update(books).set({ authors: row.oldValue as string[] }).where(where);
      restored += 1;
    }
    await tx.update(metadataChanges).set({ undoneAt: new Date() }).where(inArray(metadataChanges.id, rows.map((row) => row.id)));
  });
  return { restored, kept };
}

/** The library's spelling of a series (by `looseSeriesKey`), or the name as given. Used by every write that sets one. */
export async function resolveSeriesName(db: Database, teacherId: string, name: string): Promise<string> {
  const rows = await db.select({ series: books.series }).from(books).where(and(eq(books.teacherId, teacherId), isNotNull(books.series)));
  const known = new Map<string, number>();
  for (const { series } of rows) if (series) known.set(series, (known.get(series) ?? 0) + 1);
  return settleSeries(name, known);
}
