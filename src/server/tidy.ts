import "server-only";
import { and, asc, count, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books } from "@/db/schema";
import { sameSpelling, unifyAuthors } from "@/lib/authors";
import {
  type CatalogueFacts,
  FILLABLE,
  type GeminiAnswer,
  screenSuggestion,
  stillApplies,
  type TidyBook,
  type TidyPatch,
  type TidySuggestion,
} from "@/lib/tidy";
import { libraryAuthorSpellings, setSeriesIfMissing } from "./catalog";
import { lookupIsbn } from "./isbn-lookup";
import { matchSpine } from "./shelf-scan/match";
import { configuredModel, DEFAULT_MODEL, ENDPOINT } from "./shelf-scan/vision";

/**
 * Books looked at per press. Each may need a catalogue search for its cover, and the batch is
 * one Gemini request, so it is kept small enough to finish well inside a request.
 */
export const TIDY_BATCH = 10;
const GEMINI_TIMEOUT_MS = 90_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export type TidyFailure = "unconfigured" | "busy" | "unreadable";

export class TidyUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: TidyFailure,
  ) {
    super(message);
    this.name = "TidyUnavailableError";
  }
}

export function tidyConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export type TidyBatch = {
  checked: number;
  suggestions: TidySuggestion[];
  /** Books after this batch still to look at. */
  remaining: number;
  /** Where the next batch starts, or null when this one reached the end. */
  next: string | null;
};

/** A series the library already has, with its books, so a new book is numbered the same way. */
export type KnownSeries = { name: string; books: { title: string; number: number | null }[] };

/** What the library already says, so Gemini's answers match it. */
export type LibraryContext = {
  series: KnownSeries[];
  /** Every spelling of an author in the library, the most used first. */
  authors: string[];
};

export type AskGemini = (books: TidyBook[], library: LibraryContext, fetchFn: typeof fetch) => Promise<GeminiAnswer[]>;

const bookFields = {
  id: books.id,
  isbn13: books.isbn13,
  title: books.title,
  subtitle: books.subtitle,
  authors: books.authors,
  description: books.description,
  coverUrl: books.coverUrl,
  publisher: books.publisher,
  publishedYear: books.publishedYear,
  pageCount: books.pageCount,
  series: books.series,
  seriesNumber: books.seriesNumber,
};

/**
 * Looks at the next batch of a teacher's books, in id order from `after`, and proposes fixes:
 * details the catalogues have for the book's ISBN, a cover found by title and author, and from
 * Gemini a missing series, a tidier title and author names, and a summary where there is none.
 * Writes nothing; `applyTidy` does that once the teacher has chosen.
 */
export async function suggestTidyBatch(
  db: Database,
  teacherId: string,
  options: { after?: string | null; fetchFn?: typeof fetch; askGemini?: AskGemini } = {},
): Promise<TidyBatch> {
  const mine = eq(books.teacherId, teacherId);
  const batch: TidyBook[] = await db
    .select(bookFields)
    .from(books)
    .where(and(mine, options.after ? gt(books.id, options.after) : undefined))
    .orderBy(asc(books.id))
    .limit(TIDY_BATCH);
  if (batch.length === 0) return { checked: 0, suggestions: [], remaining: 0, next: null };

  const seriesRows = await db
    .select({ series: books.series, number: books.seriesNumber, title: books.title })
    .from(books)
    .where(and(mine, isNotNull(books.series)))
    .orderBy(asc(books.seriesNumber));
  const known = new Map<string, KnownSeries>();
  for (const row of seriesRows) {
    const entry = known.get(row.series!) ?? { name: row.series!, books: [] };
    entry.books.push({ title: row.title, number: row.number });
    known.set(row.series!, entry);
  }

  const knownAuthors = await libraryAuthorSpellings(db, teacherId);
  const fetchFn = options.fetchFn ?? fetch;
  const [catalogue, answers] = await Promise.all([
    Promise.all(batch.map((book) => catalogueFacts(db, book, options.fetchFn))),
    (options.askGemini ?? askGemini)(batch, { series: [...known.values()], authors: knownAuthors }, fetchFn),
  ]);

  const knownNames = [...known.keys()];
  // Spellings so far, the library's and then this batch's, so two answers can't drift apart by a full stop.
  const spellings = [...knownAuthors];
  const suggestions: TidySuggestion[] = [];
  for (const [index, book] of batch.entries()) {
    const gemini = { ...answers[index] };
    if (gemini.authors) gemini.authors = gemini.authors.map((name) => settleSpelling(name, spellings));
    const facts = { ...catalogue[index] };
    if (facts.authors) facts.authors = unifyAuthors(facts.authors, knownAuthors);
    const suggestion = screenSuggestion(book, { catalogue: facts, gemini, knownSeries: knownNames });
    if (suggestion) suggestions.push(suggestion);
  }

  const last = batch.at(-1)!.id;
  const [{ remaining }] = await db.select({ remaining: count() }).from(books).where(and(mine, gt(books.id, last)));
  return { checked: batch.length, suggestions, remaining, next: remaining > 0 ? last : null };
}

/** A spelling already used for this name, differing only in case, spacing or full stops; else the name, remembered. */
function settleSpelling(name: string, spellings: string[]): string {
  const settled = spellings.find((spelling) => sameSpelling(spelling, name));
  if (settled) return settled;
  spellings.push(name);
  return name;
}

/**
 * What the catalogues know about a book that it's missing: everything recorded for its ISBN,
 * and failing a cover there, the cover of a record a title and author search matches exactly.
 * A catalogue that can't be reached is no facts, never a failed batch.
 */
async function catalogueFacts(db: Database, book: TidyBook, fetchFn?: typeof fetch): Promise<CatalogueFacts> {
  const missing = book.authors.length === 0 || FILLABLE.some((field) => book[field] === null || book[field] === "");
  if (!missing) return {};
  const facts: CatalogueFacts = {};
  try {
    if (book.isbn13) {
      const found = await lookupIsbn(db, book.isbn13, fetchFn ? { fetchFn } : {});
      if (found.status === "found") {
        const { subtitle, description, coverUrl, publisher, publishedYear, pageCount, authors } = found.metadata;
        Object.assign(facts, { subtitle, description, coverUrl, publisher, publishedYear, pageCount, authors });
      }
    }
    if (!book.coverUrl && !facts.coverUrl) {
      const match = await matchSpine({ title: book.title, author: book.authors[0] ?? null }, fetchFn);
      const exact = match.candidates.find((candidate) => candidate.confidence === "exact" && candidate.coverUrl);
      if (exact) facts.coverUrl = exact.coverUrl;
    }
  } catch (error) {
    console.warn(`Tidy: catalogue facts unavailable for a book: ${(error as Error).message}`);
  }
  return facts;
}

/**
 * Applies the changes a teacher chose. Each is checked again against the book as it is now,
 * so a book edited since the suggestion was made keeps its edits, and the rules in
 * `src/lib/tidy.ts` hold however the request was made. Returns how many books changed.
 */
export async function applyTidy(db: Database, teacherId: string, changes: { bookId: string; patch: TidyPatch }[]): Promise<number> {
  if (changes.length === 0) return 0;
  const current = await db
    .select(bookFields)
    .from(books)
    .where(and(eq(books.teacherId, teacherId), inArray(books.id, changes.map((change) => change.bookId))));
  const byId = new Map(current.map((book) => [book.id, book]));

  let changed = 0;
  for (const change of changes) {
    const book = byId.get(change.bookId);
    if (!book) continue;
    const { series, ...fields } = stillApplies(book, change.patch);
    let touched = false;
    if (Object.keys(fields).length > 0) {
      await db.update(books).set(fields).where(and(eq(books.id, book.id), eq(books.teacherId, teacherId)));
      touched = true;
    }
    if (series && (await setSeriesIfMissing(db, teacherId, book.id, series))) touched = true;
    if (touched) changed += 1;
  }
  return changed;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    books: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          n: { type: "INTEGER" },
          title: { type: "STRING", nullable: true },
          authors: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
          series: { type: "STRING", nullable: true },
          seriesNumber: { type: "NUMBER", nullable: true },
          description: { type: "STRING", nullable: true },
          sure: { type: "BOOLEAN" },
        },
        required: ["n", "sure"],
      },
    },
  },
  required: ["books"],
} as const;

function prompt(batch: TidyBook[], { series: known, authors }: LibraryContext): string {
  const lines = batch.map((book, index) =>
    [
      `${index + 1}. Title: ${book.title}`,
      book.subtitle ? `   Subtitle: ${book.subtitle}` : null,
      `   Authors: ${book.authors.join("; ") || "(none recorded)"}`,
      book.isbn13 ? `   ISBN: ${book.isbn13}` : null,
      book.publisher || book.publishedYear ? `   Edition: ${[book.publisher, book.publishedYear].filter(Boolean).join(", ")}` : null,
      `   Series: ${book.series ? `${book.series}${book.seriesNumber !== null ? `, book ${book.seriesNumber}` : ""}` : "(none recorded)"}`,
      book.description ? null : "   Needs a description.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const series = known
    .slice(0, 100)
    .map(
      (entry) =>
        `- ${entry.name}: ${entry.books
          .slice(0, 20)
          .map((book) => `${book.number !== null ? `${book.number} ` : ""}${book.title}`)
          .join("; ")}`,
    );

  return `You are a school librarian tidying a classroom library's catalogue. For each numbered book below, answer with its number "n" and only the fields that need changing; leave a field null when it is already right or when you don't know.

- title: the book's title as its publisher prints it, in title case, including a leading "The" or "A" if the real title has one. The same words, only better written. Never another book's title.
- authors: the authors as their names appear on the book's cover, such as "C. S. Lewis" for "Clive Staples Lewis". The same people in the same order. If no authors are recorded, give them. Every book by one person must name them the same way: if the library already spells an author the way their covers do (listed below), use exactly that spelling, and give it for every book by them that is spelled any other way.
- series and seriesNumber: only for a book whose series is "(none recorded)". The series it belongs to as readers know it, and its place in that series. If the library already has books in that series (listed below), use the library's name for the series and number the book the same way those books are numbered. Null if the book isn't part of a series.
- description: only for a book marked "Needs a description": two or three plain sentences saying what the book is about, suitable for a school library and without spoilers.
- sure: true only if you are certain of every field you gave. A book you don't recognise gets nulls and sure false. Never guess.

Books:
${lines.join("\n")}
${series.length ? `\nSeries already in this library:\n${series.join("\n")}` : ""}${
    authors.length ? `\n\nAuthors already in this library, as they are spelled there:\n${authors.slice(0, 300).join("; ")}` : ""
  }`;
}

/** One request to Gemini for the whole batch. Answers come back in the batch's order. */
export async function askGemini(batch: TidyBook[], library: LibraryContext, fetchFn: typeof fetch = fetch): Promise<GeminiAnswer[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TidyUnavailableError("GEMINI_API_KEY is not set.", "unconfigured");
  let model = configuredModel();
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt(batch, library) }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
  });

  const started = Date.now();
  const elapsed = () => `${model}, ${Date.now() - started}ms`;
  let response: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetchFn(`${ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body,
      });
    } catch (error) {
      throw new TidyUnavailableError(`Request failed (${elapsed()}): ${(error as Error).message}`, "busy");
    }
    if (response.ok) break;
    if (response.status === 404 && model !== DEFAULT_MODEL) {
      console.error(`Tidy: model "${model}" not found; using ${DEFAULT_MODEL}. Check GEMINI_MODEL.`);
      model = DEFAULT_MODEL;
      continue;
    }
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    if (RETRYABLE.has(response.status) && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    throw new TidyUnavailableError(`HTTP ${response.status} (${elapsed()}): ${detail}`, "busy");
  }

  const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const raw = (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
  let parsed: { books?: (GeminiAnswer & { n?: number })[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TidyUnavailableError(`Answer wasn't JSON, ${raw.length} characters (${elapsed()}).`, "unreadable");
  }

  const answers: GeminiAnswer[] = batch.map(() => ({}));
  for (const answer of parsed.books ?? []) {
    const index = Number(answer.n) - 1;
    if (Number.isInteger(index) && index >= 0 && index < batch.length) answers[index] = answer;
  }
  console.info(`Tidy: asked about ${batch.length} books (${elapsed()}).`);
  return answers;
}
