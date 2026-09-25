import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { isbnLookupCache } from "@/db/schema";
import { mergeMetadata } from "./merge";
import { type BookMetadata, type Fetch, fetchGoogleBooks, fetchOpenLibrary, LookupUnavailableError } from "./sources";

export type { BookMetadata } from "./sources";

export type LookupResult =
  | { status: "found"; metadata: BookMetadata }
  | { status: "not_found" }
  | { status: "unavailable" };

const FOUND_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

type LookupOptions = { fetchFn?: Fetch; now?: Date };

/**
 * Finds public metadata for an ISBN-13: the shared cache first, then every configured
 * source at once, merged. Asking both and combining them beats stopping at the first
 * answer, because each source is stronger in different fields — see `mergeMetadata`.
 * Network failures aren't cached, and one source being down never hides a book the
 * other one knows.
 *
 * Nor is any answer given while a source was down. With Google Books refusing (its daily
 * quota spent, say) and Open Library not knowing the ISBN, "not found" was cached for a day,
 * and a book Google knows perfectly well couldn't be scanned or typed in until it expired.
 * So a book only one source could answer for is returned but not kept, and none at all is
 * "unavailable", with Try again, rather than "not found".
 */
export async function lookupIsbn(db: Database, isbn13: string, options: LookupOptions = {}): Promise<LookupResult> {
  const now = options.now ?? new Date();
  const [cached] = await db.select().from(isbnLookupCache).where(eq(isbnLookupCache.isbn13, isbn13)).limit(1);
  if (cached) {
    const age = now.getTime() - cached.fetchedAt.getTime();
    if (cached.payload && age < FOUND_TTL_MS) return { status: "found", metadata: cached.payload };
    if (!cached.payload && age < NOT_FOUND_TTL_MS) return { status: "not_found" };
  }

  const fetchFn = options.fetchFn ?? (await fixtureFetch()) ?? fetch;
  const googleKey = process.env.GOOGLE_BOOKS_API_KEY;

  // Ordered: Open Library first, then Google Books when configured.
  const attempts: Promise<BookMetadata | null>[] = [fetchOpenLibrary(isbn13, fetchFn)];
  if (googleKey) attempts.push(fetchGoogleBooks(isbn13, googleKey, fetchFn));
  const settled = await Promise.allSettled(attempts);

  const answers: (BookMetadata | null)[] = [];
  let answered = 0;
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      answers[index] = result.value;
      answered += 1;
      continue;
    }
    if (!(result.reason instanceof LookupUnavailableError)) throw result.reason;
    const label = index === 0 ? "Open Library" : "Google Books";
    console.warn(`ISBN lookup: ${label} unavailable for ${isbn13}: ${result.reason.message}`);
  }
  // Every configured source failed, so "not found" would be a lie worth caching for a day.
  if (answered === 0) return { status: "unavailable" };

  const metadata = mergeMetadata(answers[0] ?? null, answers[1] ?? null);
  if (answered < attempts.length) return metadata ? { status: "found", metadata } : { status: "unavailable" };

  await db
    .insert(isbnLookupCache)
    .values({ isbn13, payload: metadata, fetchedAt: now })
    .onConflictDoUpdate({ target: isbnLookupCache.isbn13, set: { payload: metadata, fetchedAt: now } });

  return metadata ? { status: "found", metadata } : { status: "not_found" };
}

/** With ISBN_LOOKUP_FIXTURES=1 (tests, E2E), lookups read canned responses instead of the network. */
async function fixtureFetch(): Promise<Fetch | null> {
  if (process.env.ISBN_LOOKUP_FIXTURES !== "1") return null;
  const { createFixtureFetch } = await import("./fixtures");
  return createFixtureFetch();
}
