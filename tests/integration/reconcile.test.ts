import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import { type BookDetailsInput, createBook, setSeriesIfMissing, updateBookDetails } from "@/server/catalog";
import { lastReconcile, reconcileLibrary, undoReconcile } from "@/server/reconcile";
import { applyTidy } from "@/server/tidy";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const input = (overrides: Partial<BookDetailsInput>): BookDetailsInput => ({
  isbn13: null,
  title: "T",
  subtitle: null,
  authors: ["A. Writer"],
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
});

describe("settling a library's spellings", () => {
  let testDb: TestDatabase;
  let db: Database;
  let t: string;
  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    t = await createTeacher(db, "settle@example.com");
  });
  afterAll(() => testDb.close());

  const series = async (title: string) => (await db.select({ series: books.series }).from(books).where(eq(books.title, title)))[0].series;

  it("gives a new book the library's spelling of its series", async () => {
    await createBook(db, t, input({ title: "Lion", series: "The Chronicles of Narnia", seriesNumber: 1 }));
    await createBook(db, t, input({ title: "Caspian", series: "Chronicles of Narnia", seriesNumber: 4 }));
    expect(await series("Caspian")).toBe("The Chronicles of Narnia");
    const bare = await createBook(db, t, input({ title: "Bare" }));
    await setSeriesIfMissing(db, t, bare.bookId, { name: "Narnia Series", number: 2 });
    expect(await series("Bare")).toBe("The Chronicles of Narnia");
  });

  it("settles what was saved before, logs it, and undoes it without overwriting later edits", async () => {
    await db.update(books).set({ series: "Narnia", authors: ["Clive Staples Lewis"] }).where(eq(books.title, "Caspian"));
    await db.update(books).set({ series: "Chronicles of Narnia", authors: ["C. S. Lewis"] }).where(eq(books.title, "Bare"));
    const done = await reconcileLibrary(db, t);
    expect(done?.changed).toBeGreaterThanOrEqual(2);
    expect(await series("Caspian")).toBe("The Chronicles of Narnia");
    expect(await reconcileLibrary(db, t)).toBeNull();
    expect((await lastReconcile(db, t))?.batchId).toBe(done!.batchId);

    // Edited since: its series is kept, the rest are restored.
    await db.update(books).set({ series: "Something Else" }).where(eq(books.title, "Bare"));
    const result = await undoReconcile(db, t, done!.batchId);
    expect(result.kept).toBe(1);
    expect(await series("Caspian")).toBe("Narnia");
    expect(await series("Bare")).toBe("Something Else");
    expect(await lastReconcile(db, t)).toBeNull();
  });
});

describe("fields a teacher has set", () => {
  let testDb: TestDatabase;
  let db: Database;
  let t: string;
  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    t = await createTeacher(db, "locks@example.com");
  });
  afterAll(() => testDb.close());

  const row = async (title: string) => (await db.select().from(books).where(eq(books.title, title)))[0];

  it("makes the teacher's spelling the library's, and renames the series around it", async () => {
    await createBook(db, t, input({ title: "Lion", series: "The Chronicles of Narnia" }));
    await createBook(db, t, input({ title: "Caspian", series: "The Chronicles of Narnia" }));
    await createBook(db, t, input({ title: "Dawn Treader", series: "The Chronicles of Narnia" }));
    const lion = await row("Lion");
    await updateBookDetails(db, t, lion.id, { series: "Narnia" });
    expect((await row("Lion")).series).toBe("Narnia");
    expect((await row("Lion")).fieldSources).toMatchObject({ series: "teacher" });
    expect((await row("Caspian")).series).toBe("Narnia");
    expect((await row("Caspian")).fieldSources).toEqual({});
    // A later book follows the teacher's spelling too.
    await createBook(db, t, input({ title: "Silver Chair", series: "Chronicles of Narnia" }));
    expect((await row("Silver Chair")).series).toBe("Narnia");
  });

  it("never refills or rewrites what the teacher set, even a field they cleared", async () => {
    await createBook(db, t, input({ title: "Cleared", description: "Old blurb." }));
    const cleared = await row("Cleared");
    await updateBookDetails(db, t, cleared.id, { description: null, title: "Cleared" });
    expect((await row("Cleared")).fieldSources).toMatchObject({ description: "teacher" });
    const applied = await applyTidy(db, t, [{ bookId: cleared.id, patch: { description: "Gemini's blurb.", pageCount: 321 }, sources: { description: "gemini", pageCount: "catalogue" } }]);
    expect(applied).toBe(1);
    const after = await row("Cleared");
    expect(after.description).toBeNull();
    // Only the field the teacher set is left alone; others still fill.
    expect(after.pageCount).toBe(321);
  });

  it("records where an applied field came from", async () => {
    await createBook(db, t, input({ title: "Blank", description: null, pageCount: null }));
    const blank = await row("Blank");
    await applyTidy(db, t, [{ bookId: blank.id, patch: { description: "From Gemini.", pageCount: 250 }, sources: { description: "gemini", pageCount: "catalogue" } }]);
    expect((await row("Blank")).fieldSources).toEqual({ description: "gemini", pageCount: "catalogue" });
  });

  it("records a bulk genre as the teacher's", async () => {
    const blank = await row("Blank");
    const { bulkUpdateBooks } = await import("@/server/catalog");
    await bulkUpdateBooks(db, t, [blank.id], { location: "Bin 3" });
    expect((await row("Blank")).fieldSources).toEqual({ description: "gemini", pageCount: "catalogue" });
    await bulkUpdateBooks(db, t, [blank.id], { readingLevel: "N" });
    expect((await row("Blank")).fieldSources).toMatchObject({ readingLevel: "teacher", pageCount: "catalogue" });
  });
});
