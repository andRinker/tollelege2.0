import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import { type BookDetailsInput, createBook, setSeriesIfMissing, updateBookDetails } from "@/server/catalog";
import { lastReconcile, reconcileLibrary, undoReconcile } from "@/server/reconcile";
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
    const [{ id }] = await db.select({ id: books.id }).from(books).where(eq(books.title, "Lion"));
    await updateBookDetails(db, t, id, { series: "Narnia" });
    expect(await series("Lion")).toBe("The Chronicles of Narnia");
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
