import type { Database } from "@/db/client";
import { normalizeIsbn } from "@/lib/isbn";
import { addCopies, findBookByIsbn, type QuickAddResult, quickAddByIsbn } from "./catalog";
import { lookupIsbn } from "./isbn-lookup";

export type QuickAddOutcome =
  | { status: "added"; isbn13: string; result: QuickAddResult }
  | { status: "invalid" }
  | { status: "not_found"; isbn13: string }
  | { status: "unavailable"; isbn13: string };

/**
 * One scanned barcode becomes one book, however it was scanned. The USB wedge, the
 * laptop camera and a paired phone all land here, so they can't drift into behaving
 * differently — a teacher who scans the same shelf two ways should get the same library.
 *
 * A book the teacher already owns gains a copy without a metadata lookup, which is both
 * faster and the right answer: a second physical copy is not a second title.
 */
export async function addBookByScan(db: Database, teacherId: string, raw: string): Promise<QuickAddOutcome> {
  const isbn13 = normalizeIsbn(String(raw));
  if (!isbn13) return { status: "invalid" };

  const owned = await findBookByIsbn(db, teacherId, isbn13);
  if (owned) {
    const { copyIds, totalCopies } = await addCopies(db, teacherId, owned.id);
    return {
      status: "added",
      isbn13,
      result: {
        outcome: "copy_added",
        bookId: owned.id,
        copyId: copyIds[0],
        title: owned.title,
        authors: owned.authors,
        coverUrl: owned.coverUrl,
        totalCopies,
      },
    };
  }

  const lookup = await lookupIsbn(db, isbn13);
  if (lookup.status !== "found") return { status: lookup.status, isbn13 };
  return { status: "added", isbn13, result: await quickAddByIsbn(db, teacherId, isbn13, lookup.metadata) };
}
