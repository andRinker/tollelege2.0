import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import { type BookDetailsInput, createBook, fillSeries, listLibrary } from "@/server/catalog";
import { lastReconcile, undoReconcile } from "@/server/reconcile";
import { startTidyRun, stepTidyRun } from "@/server/tidy-run";
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

  it("finds a series through a Fix everything run: the catalogue's wins, a teacher's cleared one is left alone, and it undoes", async () => {
    const t = await createTeacher(db);
    const found = await createBook(db, t, bookInput({ title: "Book 2", isbn13: isbnFor(2) }));
    const quiet = await createBook(db, t, bookInput({ title: "Book 3", isbn13: isbnFor(3) }));
    const cleared = await createBook(db, t, bookInput({ title: "Book 4", isbn13: isbnFor(4) }));
    await db.update(books).set({ fieldSources: { series: "teacher" } }).where(eq(books.id, cleared.bookId));
    const existing = await createBook(db, t, bookInput({ title: "Kept", isbn13: isbnFor(99), series: "Mine", seriesNumber: 2 }));

    const fetchFn = (async (input: RequestInfo | URL) => {
      const edition = String(input).match(/isbn\/(\d+)\.json/);
      if (!edition) return Response.json({ docs: [] });
      const n = Number(edition[1].slice(-6));
      if (n % 2 === 0) return Response.json({ title: `Book ${n}`, series: [`The 39 clues ; bk. ${n}`] });
      return Response.json({ title: `Book ${n}` });
    }) as Fetch;
    const answers = async (batch: { title: string }[]) => batch.map(() => ({}));

    await startTidyRun(db, t, { confident: true });
    let step = await stepTidyRun(db, t, { fetchFn, askGemini: answers });
    while (step.status?.state === "running") step = await stepTidyRun(db, t, { fetchFn, askGemini: answers });

    expect(await seriesOf(found.bookId)).toEqual({ series: "The 39 Clues", number: 2 });
    expect(await seriesOf(quiet.bookId)).toEqual({ series: null, number: null });
    expect(await seriesOf(cleared.bookId)).toEqual({ series: null, number: null });
    expect(await seriesOf(existing.bookId)).toEqual({ series: "Mine", number: 2 });
    const [row] = await db.select({ sources: books.fieldSources }).from(books).where(eq(books.id, found.bookId));
    expect(row.sources).toMatchObject({ series: "catalogue" });

    const last = await lastReconcile(db, t);
    expect(last).not.toBeNull();
    await undoReconcile(db, t, last!.batchId);
    expect(await seriesOf(found.bookId)).toEqual({ series: null, number: null });
  });

  it("never fills a series a teacher cleared, however it is found", async () => {
    const t = await createTeacher(db);
    const { bookId } = await createBook(db, t, bookInput({ title: "Cleared" }));
    await db.update(books).set({ fieldSources: { series: "teacher" } }).where(eq(books.id, bookId));
    await fillSeries(db, t, bookId, "Wonder");
    expect(await seriesOf(bookId)).toEqual({ series: null, number: null });
  });

  it("stacks books whose series names spelled out their place, once, with a migration", async () => {
    const t = await createTeacher(db);
    const horse = await createBook(db, t, bookInput({ title: "The Horse and His Boy", series: "The Chronicles of Narnia, Book Three" }));
    const battle = await createBook(db, t, bookInput({ title: "The Last Battle", series: "Chronicles of Narnia", seriesNumber: 7 }));
    const lord = await createBook(db, t, bookInput({ title: "Fellowship", series: "The Lord of the Rings (Volume One)", seriesNumber: 1.5 }));
    const club = await createBook(db, t, bookInput({ title: "Club", series: "The Mysterious Benedict Society, Book Club" }));

    const migration = readFileSync("drizzle/0015_series_spelled_numbers.sql", "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));

    expect(await seriesOf(horse.bookId)).toEqual({ series: "The Chronicles of Narnia", number: 3 });
    expect(await seriesOf(battle.bookId)).toEqual({ series: "Chronicles of Narnia", number: 7 });
    // A number already set is kept; only the name is tidied.
    expect(await seriesOf(lord.bookId)).toEqual({ series: "The Lord of the Rings", number: 1.5 });
    expect(await seriesOf(club.bookId)).toEqual({ series: "The Mysterious Benedict Society, Book Club", number: null });

    const library = await listLibrary(db, t, { group: true });
    const narnia = library.entries.find((entry) => entry.kind === "series");
    expect(narnia?.kind === "series" && narnia.series.bookIds).toEqual([horse.bookId, battle.bookId]);
  });
});
