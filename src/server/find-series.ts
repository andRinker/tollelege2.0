import { and, asc, count, eq, gt, isNotNull, isNull, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import { setSeriesIfMissing } from "./catalog";
import { LookupUnavailableError, lookupSeries } from "./isbn-lookup";
import type { Fetch } from "./isbn-lookup/sources";

/** Books checked per press. Each is one request to Open Library, a few at a time. */
export const FIND_SERIES_BATCH = 25;
const AT_ONCE = 5;

export type FindSeriesResult = {
  checked: number;
  found: number;
  /** Books Open Library didn't answer for. Still without a series, so a fresh run asks again. */
  unanswered: number;
  /** Books with an ISBN and no series still after this batch. */
  remaining: number;
  /** Where the next batch starts, or null when this one reached the end. */
  next: string | null;
};

/**
 * Asks Open Library for the series of books catalogued before series were read, a batch at
 * a time, in id order from `after` so repeated presses walk the whole library rather than
 * asking about the same books again. Only books with an ISBN and no series are asked about,
 * and a series is only ever filled in, never replaced.
 */
export async function findSeriesBatch(
  db: Database,
  teacherId: string,
  options: { after?: string | null; fetchFn?: Fetch } = {},
): Promise<FindSeriesResult> {
  const unset: SQL[] = [eq(books.teacherId, teacherId), isNotNull(books.isbn13), isNull(books.series)];
  const batch = await db
    .select({ id: books.id, isbn13: books.isbn13 })
    .from(books)
    .where(and(...unset, options.after ? gt(books.id, options.after) : undefined))
    .orderBy(asc(books.id))
    .limit(FIND_SERIES_BATCH);

  let found = 0;
  let unanswered = 0;
  for (let start = 0; start < batch.length; start += AT_ONCE) {
    await Promise.all(
      batch.slice(start, start + AT_ONCE).map(async (book) => {
        try {
          const series = await lookupSeries(book.isbn13!, { fetchFn: options.fetchFn });
          if (series && (await setSeriesIfMissing(db, teacherId, book.id, series))) found += 1;
        } catch (error) {
          if (!(error instanceof LookupUnavailableError)) throw error;
          unanswered += 1;
        }
      }),
    );
  }

  const last = batch.at(-1)?.id;
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(books)
    .where(and(...unset, last ? gt(books.id, last) : undefined));
  return { checked: batch.length, found, unanswered, remaining, next: remaining > 0 && last ? last : null };
}
