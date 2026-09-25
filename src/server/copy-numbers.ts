import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { copies } from "@/db/schema";

/**
 * Closes the gaps a deleted copy leaves, so a title's copies always read 1, 2, 3… A teacher
 * who deletes copy 1 of three expects to see copies 1 and 2, not 2 and 3.
 *
 * Copies keep their order, and each moves down one at a time from the lowest: the number it
 * takes is always free by then, which the unique (book, number) key needs.
 */
export async function renumberCopies(tx: Database, bookId: string): Promise<void> {
  const rows = await tx
    .select({ id: copies.id, copyNumber: copies.copyNumber })
    .from(copies)
    .where(eq(copies.bookId, bookId))
    .orderBy(asc(copies.copyNumber));
  for (const [index, row] of rows.entries()) {
    if (row.copyNumber !== index + 1) await tx.update(copies).set({ copyNumber: index + 1 }).where(eq(copies.id, row.id));
  }
}
