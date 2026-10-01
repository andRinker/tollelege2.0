import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import { type BookDetailsInput, createBook, fillSeries } from "@/server/catalog";
import { FIND_SERIES_BATCH, findSeriesBatch } from "@/server/find-series";
import type { Fetch } from "@/server/isbn-lookup/sources";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

function bookInput(overrides: Partial<BookDetailsInput> = {}): BookDetailsInput {
  return {
    isbn13: null,
    title: "Untitled",
    subtitle: null,
    authors: [],
    description: null,
    coverUrl: null,
    publisher: null,
    publishedYear: null,
    pageCount: null,
    readingLevel: null,
    tags: [],
    location: null,
    notes: null,
    metadataSource: "manual",
    ...overrides,
  };
}

const isbnFor = (n: number) => `9780000${String(n).padStart(6, "0")}`;

describe("series", () => {
  let testDb: TestDatabase;
  let db: Database;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });

  afterAll(async () => {
    await testDb.close();
  });

  const seriesOf = async (bookId: string) =>
    (await db.select({ series: books.series, number: books.seriesNumber }).from(books).where(eq(books.id, bookId)))[0];

  it("fills a series from a spine, tidied and in the library's own spelling, and never replaces one", async () => {
    const t = await createTeacher(db);
    const nixie = await createBook(db, t, bookInput({ title: "The Nixie's Song" }));
    await fillSeries(db, t, nixie.bookId, "BEYOND THE SPIDERWICK CHRONICLES");
    expect(await seriesOf(nixie.bookId)).toEqual({ series: "Beyond the Spiderwick Chronicles", number: null });

    // A second spine spelled differently joins the first's series rather than starting another.
    const giant = await createBook(db, t, bookInput({ title: "A Giant Problem" }));
    await fillSeries(db, t, giant.bookId, "beyond the spiderwick chronicles");
    expect((await seriesOf(giant.bookId)).series).toBe("Beyond the Spiderwick Chronicles");

    const typed = await createBook(db, t, bookInput({ title: "Wonder", series: "Wonder", seriesNumber: 1 }));
    await fillSeries(db, t, typed.bookId, "Something Else");
    expect(await seriesOf(typed.bookId)).toEqual({ series: "Wonder", number: 1 });
  });

  it("finds series for a whole library a batch at a time, from where it left off", async () => {
    const t = await createTeacher(db);
    const ids: string[] = [];
    for (let n = 1; n <= FIND_SERIES_BATCH + 5; n++) {
      const { bookId } = await createBook(db, t, bookInput({ title: `Book ${n}`, isbn13: isbnFor(n) }));
      ids.push(bookId);
    }
    // One with no ISBN and one with a series already aren't asked about.
    await createBook(db, t, bookInput({ title: "No ISBN" }));
    const kept = await createBook(db, t, bookInput({ title: "Kept", isbn13: isbnFor(99), series: "Mine", seriesNumber: 2 }));

    const asked: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const isbn = String(input).match(/isbn\/(\d+)\.json/)![1];
      asked.push(isbn);
      const n = Number(isbn.slice(-6));
      // Book 4 has a series, but Open Library is too busy to say so the first time it's asked.
      if (n === 4 && asked.filter((asking) => asking === isbn).length === 1) return new Response("Busy", { status: 503 });
      if (n % 2 === 0) return Response.json({ title: `Book ${n}`, series: [`The 39 clues ; bk. ${n}`] });
      return Response.json({ title: `Book ${n}` });
    }) as Fetch;

    const first = await findSeriesBatch(db, t, { fetchFn });
    expect(first).toMatchObject({ checked: FIND_SERIES_BATCH, remaining: 5 });
    expect(first.next).not.toBeNull();
    const second = await findSeriesBatch(db, t, { after: first.next, fetchFn });
    expect(second).toMatchObject({ checked: 5, remaining: 0, next: null });
    // Books are walked in id order, so which batch meets the busy answer varies; one does.
    const unanswered = [...first.unansweredIds, ...second.unansweredIds];
    expect(unanswered).toEqual([ids[3]]);
    expect(first.found + second.found).toBe(14);
    expect(await seriesOf(ids[3])).toEqual({ series: null, number: null });

    // Asking again about just the unanswered book finds its series, and walks nothing else.
    const retried = await findSeriesBatch(db, t, { ids: unanswered, fetchFn });
    expect(retried).toMatchObject({ checked: 1, found: 1, unansweredIds: [], next: null });

    expect(asked).not.toContain(isbnFor(99));
    expect(asked).toHaveLength(FIND_SERIES_BATCH + 6);
    expect(new Set(asked).size).toBe(FIND_SERIES_BATCH + 5);
    expect(await seriesOf(kept.bookId)).toEqual({ series: "Mine", number: 2 });
    const withSeries = await Promise.all(ids.map(seriesOf));
    expect(withSeries[3]).toEqual({ series: "The 39 Clues", number: 4 });
    expect(withSeries[2]).toEqual({ series: null, number: null });
  });
});
