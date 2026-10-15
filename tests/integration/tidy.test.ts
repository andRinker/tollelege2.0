import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import type { GeminiAnswer } from "@/lib/tidy";
import { type BookDetailsInput, createBook } from "@/server/catalog";
import { type AskGemini, applyTidy, askGemini, suggestTidyBatch, TIDY_BATCH } from "@/server/tidy";
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

/** Open Library knows one ISBN, with a cover and a page count, and nothing else. */
const LWW = "9780007627080";
const catalogueFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url === `https://openlibrary.org/isbn/${LWW}.json`) {
    return Response.json({ title: "The Lion, the Witch and the Wardrobe", covers: [123], number_of_pages: 186 });
  }
  if (url.startsWith("https://openlibrary.org/search.json")) return Response.json({ docs: [] });
  return new Response("not found", { status: 404 });
};

/** Gemini, as the tests need it: answers by title, and remembers what it was asked. */
function fakeGemini(answers: Record<string, GeminiAnswer>) {
  const asked: { titles: string[]; series: string[]; authors: string[] }[] = [];
  const ask: AskGemini = async (batch, library) => {
    asked.push({ titles: batch.map((book) => book.title), series: library.series.map((entry) => entry.name), authors: library.authors });
    return batch.map((book) => answers[book.title] ?? {});
  };
  return { ask, asked };
}

describe("tidy my library", () => {
  let testDb: TestDatabase;
  let db: Database;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });

  afterAll(async () => {
    await testDb.close();
  });

  const read = async (bookId: string) => (await db.select().from(books).where(eq(books.id, bookId)))[0];

  it("suggests Narnia for the book Open Library left out, and applies only what the teacher ticks", async () => {
    const t = await createTeacher(db);
    await createBook(db, t, bookInput({ title: "The Horse and His Boy", authors: ["C. S. Lewis"], series: "The Chronicles of Narnia", seriesNumber: 3 }));
    const lww = await createBook(
      db,
      t,
      bookInput({ isbn13: LWW, title: "Lion, the Witch And The Wardrobe", authors: ["Clive Staples Lewis"], publisher: "Collins", description: "Kept as it is." }),
    );
    // Adding it now would take the library's "C. S. Lewis"; this is a book saved before that.
    await db.update(books).set({ authors: ["Clive Staples Lewis"] }).where(eq(books.id, lww.bookId));
    const gemini = fakeGemini({
      "Lion, the Witch And The Wardrobe": {
        title: "The Lion, the Witch and the Wardrobe",
        authors: ["C. S. Lewis"],
        series: "Chronicles of Narnia",
        seriesNumber: 2,
        sure: true,
      },
    });

    const batch = await suggestTidyBatch(db, t, { fetchFn: catalogueFetch, askGemini: gemini.ask });
    expect(batch).toMatchObject({ checked: 2, remaining: 0, next: null });
    expect(gemini.asked[0].series).toEqual(["The Chronicles of Narnia"]);
    expect(batch.suggestions).toHaveLength(1);
    const [suggestion] = batch.suggestions;
    expect(suggestion.patch).toEqual({
      title: "The Lion, the Witch and the Wardrobe",
      authors: ["C. S. Lewis"],
      series: { name: "The Chronicles of Narnia", number: 2 },
      coverUrl: "https://covers.openlibrary.org/b/id/123-M.jpg",
      pageCount: 186,
    });
    expect(suggestion.sure).toBe(true);
    // Nothing is written until the teacher applies it.
    expect((await read(lww.bookId)).series).toBeNull();

    expect(await applyTidy(db, t, [{ bookId: lww.bookId, patch: suggestion.patch }])).toBe(1);
    expect(await read(lww.bookId)).toMatchObject({
      title: "The Lion, the Witch and the Wardrobe",
      authors: ["C. S. Lewis"],
      series: "The Chronicles of Narnia",
      seriesNumber: 2,
      coverUrl: "https://covers.openlibrary.org/b/id/123-M.jpg",
      pageCount: 186,
      publisher: "Collins",
      description: "Kept as it is.",
    });
  });

  it("gives every book by one author the library's spelling", async () => {
    const t = await createTeacher(db);
    await createBook(db, t, bookInput({ title: "Prince Caspian", authors: ["C. S. Lewis"] }));
    await createBook(db, t, bookInput({ title: "The Last Battle", authors: ["C. S. Lewis"] }));
    // A new book takes the library's spelling of the same person, and keeps a different person as given.
    const added = await createBook(db, t, bookInput({ title: "The Silver Chair", authors: ["Clive Staples Lewis", "Pauline Baynes"] }));
    expect((await read(added.bookId)).authors).toEqual(["C. S. Lewis", "Pauline Baynes"]);

    const old = await createBook(db, t, bookInput({ title: "The Magician's Nephew" }));
    await db.update(books).set({ authors: ["Clive Staples Lewis"] }).where(eq(books.id, old.bookId));
    const drifted = await createBook(db, t, bookInput({ title: "The Voyage of the Dawn Treader" }));
    await db.update(books).set({ authors: ["C.S. Lewis"] }).where(eq(books.id, drifted.bookId));

    // Gemini drifts by a full stop on one book; the library's own spelling wins.
    const gemini = fakeGemini({
      "The Magician's Nephew": { authors: ["C. S. Lewis"], sure: true },
      "The Voyage of the Dawn Treader": { authors: ["C.S. Lewis"], sure: true },
    });
    const batch = await suggestTidyBatch(db, t, { fetchFn: catalogueFetch, askGemini: gemini.ask });
    expect(gemini.asked[0].authors[0]).toBe("C. S. Lewis");
    const byTitle = Object.fromEntries(batch.suggestions.map((suggestion) => [suggestion.title, suggestion.patch.authors]));
    expect(byTitle).toEqual({ "The Magician's Nephew": ["C. S. Lewis"], "The Voyage of the Dawn Treader": ["C. S. Lewis"] });
  });

  it("checks a change again when it is applied, so edits since and other teachers' books are safe", async () => {
    const t = await createTeacher(db);
    const other = await createTeacher(db);
    const mine = await createBook(db, t, bookInput({ title: "Wonder", authors: ["R. J. Palacio"], pageCount: 310 }));
    const theirs = await createBook(db, other, bookInput({ title: "Holes", authors: ["Louis Sachar"] }));

    const applied = await applyTidy(db, t, [
      { bookId: mine.bookId, patch: { title: "Wonderstruck", pageCount: 999, series: { name: "Wonder", number: 1 } } },
      { bookId: theirs.bookId, patch: { series: { name: "Holes", number: 1 } } },
    ]);
    expect(applied).toBe(1);
    expect(await read(mine.bookId)).toMatchObject({ title: "Wonder", pageCount: 310, series: "Wonder", seriesNumber: 1 });
    expect((await read(theirs.bookId)).series).toBeNull();
  });

  it("walks the library a batch at a time", async () => {
    const t = await createTeacher(db);
    for (let n = 0; n < TIDY_BATCH + 2; n++) await createBook(db, t, bookInput({ title: `Book ${n}`, authors: ["A. Writer"] }));
    const gemini = fakeGemini({});
    const first = await suggestTidyBatch(db, t, { fetchFn: catalogueFetch, askGemini: gemini.ask });
    expect(first).toMatchObject({ checked: TIDY_BATCH, remaining: 2 });
    const second = await suggestTidyBatch(db, t, { after: first.next, fetchFn: catalogueFetch, askGemini: gemini.ask });
    expect(second).toMatchObject({ checked: 2, remaining: 0, next: null });
    expect(new Set([...gemini.asked[0].titles, ...gemini.asked[1].titles]).size).toBe(TIDY_BATCH + 2);
  });

  it("asks Gemini about the whole batch at once and reads its answers back by number", async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    let prompt = "";
    const fetchFn: typeof fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
      const answer = { books: [{ n: 2, series: "The Chronicles of Narnia", seriesNumber: 2, sure: true }, { n: 9, title: "Stray" }] };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
    };
    try {
      const shelf = ["Holes", "Lion, the Witch And The Wardrobe"].map((title, index) => ({
        id: String(index),
        isbn13: null,
        title,
        subtitle: null,
        authors: ["Someone"],
        description: null,
        coverUrl: null,
        publisher: null,
        publishedYear: null,
        pageCount: null,
        series: null,
        seriesNumber: null,
      }));
      const answers = await askGemini(
        shelf,
        { series: [{ name: "The Chronicles of Narnia", books: [{ title: "The Horse and His Boy", number: 3 }] }], authors: ["C. S. Lewis", "Louis Sachar"] },
        fetchFn,
      );
      expect(answers).toEqual([{}, { n: 2, series: "The Chronicles of Narnia", seriesNumber: 2, sure: true }]);
      expect(prompt).toContain("2. Title: Lion, the Witch And The Wardrobe");
      expect(prompt).toContain("- The Chronicles of Narnia: 3 The Horse and His Boy");
      expect(prompt).toContain("C. S. Lewis; Louis Sachar");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
