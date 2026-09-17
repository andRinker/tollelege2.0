import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Normalized book metadata returned by an ISBN lookup. Public data only. */
export type CachedBookMetadata = {
  isbn13: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  coverUrl: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  source: "openlibrary" | "google_books";
};

/** Shared across teachers: it holds only public book metadata, never teacher data. */
export const isbnLookupCache = pgTable("isbn_lookup_cache", {
  isbn13: text("isbn13").primaryKey(),
  /** Null records a lookup that found nothing. */
  payload: jsonb("payload").$type<CachedBookMetadata | null>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
