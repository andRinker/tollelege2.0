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
  const asked: { titles: string[]; series: string[] }[] = [];
  const ask: AskGemini = async (batch, known) => {
    asked.push({ titles: batch.map((book) => book.title), series: known.map((entry) => entry.name) });
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
      const answers = await askGemini(shelf, [{ name: "The Chronicles of Narnia", books: [{ title: "The Horse and His Boy", number: 3 }] }], fetchFn);
      expect(answers).toEqual([{}, { n: 2, series: "The Chronicles of Narnia", seriesNumber: 2, sure: true }]);
      expect(prompt).toContain("2. Title: Lion, the Witch And The Wardrobe");
      expect(prompt).toContain("- The Chronicles of Narnia: 3 The Horse and His Boy");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
