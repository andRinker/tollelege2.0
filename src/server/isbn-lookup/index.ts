import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { isbnLookupCache } from "@/db/schema";
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
 * Finds public metadata for an ISBN-13: the shared cache first, then Open Library, then
 * Google Books when GOOGLE_BOOKS_API_KEY is set. Network failures aren't cached.
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
  let metadata: BookMetadata | null;
  try {
    metadata = await fetchOpenLibrary(isbn13, fetchFn);
    const googleKey = process.env.GOOGLE_BOOKS_API_KEY;
    if (!metadata && googleKey) metadata = await fetchGoogleBooks(isbn13, googleKey, fetchFn);
  } catch (error) {
    if (error instanceof LookupUnavailableError) {
      console.warn(`ISBN lookup unavailable for ${isbn13}: ${error.message}`);
      return { status: "unavailable" };
    }
    throw error;
  }

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
