import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books, tidyRuns } from "@/db/schema";
import type { GeminiAnswer } from "@/lib/tidy";
import { type BookDetailsInput, createBook } from "@/server/catalog";
import { type AskGemini, suggestTidyBatch, TidyUnavailableError } from "@/server/tidy";
import { applyTidyRun, discardTidyRun, getTidyRunStatus, startTidyRun, stepTidyRun, tidyRunSuggestions } from "@/server/tidy-run";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

function bookInput(overrides: Partial<BookDetailsInput> = {}): BookDetailsInput {
  return {
    isbn13: null,
    title: "Untitled",
    subtitle: null,
    authors: ["A. Writer"],
    description: "Already described.",
    coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
    publisher: "Someone",
    publishedYear: 2000,
    pageCount: 100,
    readingLevel: null,
    tags: [],
    location: null,
    notes: null,
    metadataSource: "manual",
    ...overrides,
  };
}

const noCatalogue: typeof fetch = async () => new Response("not found", { status: 404 });

function fakeGemini(answers: Record<string, GeminiAnswer>) {
  const asked: { titles: string[]; series: string[]; authors: string[] }[] = [];
  const ask: AskGemini = async (batch, library) => {
    asked.push({ titles: batch.map((book) => book.title), series: library.series.map((entry) => entry.name), authors: library.authors });
    return batch.map((book) => answers[book.title] ?? {});
  };
  return { ask, asked };
}

describe("tidying the whole library at one press", () => {
  let testDb: TestDatabase;
  let db: Database;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("walks every book, keeps what it finds, and applies only what is ticked at the end", async () => {
    const t = await createTeacher(db);
    for (let n = 0; n < 12; n++) await createBook(db, t, bookInput({ title: `Book ${n}` }));
    const gemini = fakeGemini({
      "Book 3": { series: "Dog Man", seriesNumber: 1, sure: true },
      "Book 7": { series: "Dog Man", seriesNumber: 2, sure: false },
    });
    const options = { fetchFn: noCatalogue, askGemini: gemini.ask };

    expect(await startTidyRun(db, t)).toEqual({ state: "running", checked: 0, total: 12, found: 0, error: null });
    const first = await stepTidyRun(db, t, options);
    expect(first.status).toMatchObject({ state: "running", checked: 10, total: 12 });

    // Another tab already working on a batch: nothing is asked twice.
    await db.update(tidyRuns).set({ claimedUntil: new Date(Date.now() + 60_000) }).where(eq(tidyRuns.teacherId, t));
    expect(await stepTidyRun(db, t, options)).toMatchObject({ busy: true, status: { checked: 10 } });
    expect(gemini.asked).toHaveLength(1);
    await db.update(tidyRuns).set({ claimedUntil: null }).where(eq(tidyRuns.teacherId, t));

    // Nothing to review until every book has been looked at.
    expect(await tidyRunSuggestions(db, t)).toEqual([]);
    const last = await stepTidyRun(db, t, options);
    expect(last.status).toEqual({ state: "ready", checked: 12, total: 12, found: 2, error: null });
    expect(new Set(gemini.asked.flatMap((ask) => ask.titles)).size).toBe(12);
    // A finished run asks nothing more.
    expect((await stepTidyRun(db, t, options)).busy).toBe(false);
    expect(gemini.asked).toHaveLength(2);

    const found = await tidyRunSuggestions(db, t);
    expect(found.map((suggestion) => suggestion.title).sort()).toEqual(["Book 3", "Book 7"]);
    // Nothing has changed in the library yet.
    expect((await db.select().from(books).where(eq(books.teacherId, t))).every((book) => book.series === null)).toBe(true);

    const book3 = found.find((suggestion) => suggestion.title === "Book 3")!.bookId;
    expect(await applyTidyRun(db, t, [book3])).toBe(1);
    const shelf = await db.select().from(books).where(eq(books.teacherId, t));
    expect(shelf.filter((book) => book.series === "Dog Man").map((book) => book.title)).toEqual(["Book 3"]);
    expect(await getTidyRunStatus(db, t)).toBeNull();
  });

  it("keeps its place when a batch fails, and says why", async () => {
    const t = await createTeacher(db);
    await createBook(db, t, bookInput({ title: "Holes" }));
    await startTidyRun(db, t);
    const failing: AskGemini = async () => {
      throw new TidyUnavailableError("Gemini answered 503", "busy");
    };
    await expect(stepTidyRun(db, t, { fetchFn: noCatalogue, askGemini: failing })).rejects.toThrow(TidyUnavailableError);
    expect(await getTidyRunStatus(db, t)).toEqual({ state: "running", checked: 0, total: 1, found: 0, error: "Gemini answered 503" });

    // The claim was let go, so the next try goes ahead.
    const retried = await stepTidyRun(db, t, { fetchFn: noCatalogue, askGemini: fakeGemini({}).ask });
    expect(retried.status).toEqual({ state: "ready", checked: 1, total: 1, found: 0, error: null });
  });

  it("only applies a finished run's own suggestions, to the teacher's own books", async () => {
    const t = await createTeacher(db);
    const other = await createTeacher(db);
    const theirs = await createBook(db, other, bookInput({ title: "Wonder" }));
    await createBook(db, t, bookInput({ title: "Frindle" }));
    await startTidyRun(db, t);
    expect(await applyTidyRun(db, t, [theirs.bookId])).toBe(0);
    await stepTidyRun(db, t, { fetchFn: noCatalogue, askGemini: fakeGemini({ Frindle: { series: "Frindle", sure: true } }).ask });
    expect(await applyTidyRun(db, t, [theirs.bookId])).toBe(0);
    expect((await db.select().from(books).where(eq(books.id, theirs.bookId)))[0].series).toBeNull();

    await startTidyRun(db, t);
    await discardTidyRun(db, t);
    expect(await getTidyRunStatus(db, t)).toBeNull();
  });

  it("names a series and an author the way earlier batches of the run did", async () => {
    const t = await createTeacher(db);
    const book = await createBook(db, t, bookInput({ title: "Prince Caspian", authors: ["Clive Staples Lewis"] }));
    const gemini = fakeGemini({});
    await suggestTidyBatch(db, t, {
      fetchFn: noCatalogue,
      askGemini: gemini.ask,
      pending: [
        {
          bookId: book.bookId,
          title: "Lion, the Witch And The Wardrobe",
          authors: ["Clive Staples Lewis"],
          coverUrl: null,
          patch: { authors: ["C. S. Lewis"], series: { name: "The Chronicles of Narnia", number: 2 } },
          sources: { authors: "gemini", series: "gemini" },
          sure: true,
        },
      ],
    });
    expect(gemini.asked[0].series).toEqual(["The Chronicles of Narnia"]);
    expect(gemini.asked[0].authors).toEqual(["Clive Staples Lewis", "C. S. Lewis"]);
  });
});
