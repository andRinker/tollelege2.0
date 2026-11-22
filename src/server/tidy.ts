import "server-only";
import { and, asc, count, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, changeFields, genres } from "@/db/schema";
import type { ReadingLevelSystem } from "@/db/schema/enums";
import { sameSpelling, unifyAuthors } from "@/lib/authors";
import { lockedFields, readSources, type TrackedField } from "@/lib/provenance";
import { looseSeriesKey } from "@/lib/series";
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
import { libraryAuthorSpellings, normalizeTags, setSeriesIfMissing } from "./catalog";
import { listGenres } from "./genres";
import { type LoggedChange, logChanges } from "./reconcile";
import { getTeacherSettings } from "./settings";
import { LookupUnavailableError, lookupIsbn, lookupSeries } from "./isbn-lookup";
import { matchSpine } from "./shelf-scan/match";
import { countKeys, readGeminiStream, streamUrl } from "./gemini-stream";
import { configuredModel, DEFAULT_MODEL, ENDPOINT, thinkingLevel } from "./shelf-scan/vision";

/**
 * Books looked at per press. Each may need a catalogue search for its cover, and the batch is
 * one Gemini request, so it is kept small enough to finish well inside a request.
 */
export const TIDY_BATCH = 10;
/**
 * The longest one Gemini request may take, start to finish. Measured on a real library with
 * a blocking request, a batch took 5 to 90 seconds and twice hit the old 90-second cap, so
 * the request now streams and is given most of its route's 300 seconds. A stream that goes
 * quiet for `GEMINI_IDLE_MS` is given up on long before that.
 */
const GEMINI_TIMEOUT_MS = 240_000;
const GEMINI_IDLE_MS = 60_000;
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
  /** The teacher's genre names; a book may be given one of these and nothing else. */
  genres: string[];
  /** How the teacher grades reading levels, or "none" when they don't. */
  readingLevelSystem: ReadingLevelSystem;
};

/** How far Gemini has got through a batch, as its answer streams in. */
export type TidyProgress = { answered: number; total: number };

export type AskGemini = (
  books: TidyBook[],
  library: LibraryContext,
  fetchFn: typeof fetch,
  onProgress?: (progress: TidyProgress) => void,
) => Promise<GeminiAnswer[]>;

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
  readingLevel: books.readingLevel,
  tags: books.tags,
  genreId: books.genreId,
  fieldSources: books.fieldSources,
};

/** A selected row as a `TidyBook`: the fields a teacher has set become its locks. */
function tidyBook<Row extends { fieldSources: unknown }>({ fieldSources, ...book }: Row): Omit<Row, "fieldSources"> & { locked: TrackedField[] } {
  return { ...book, locked: lockedFields(readSources(fieldSources)) };
}

/**
 * Looks at the next batch of a teacher's books, in id order from `after`, and proposes fixes:
 * details the catalogues have for the book's ISBN, a cover found by title and author, and from
 * Gemini a missing series, a tidier title and author names, and a summary where there is none.
 * Writes nothing; `applyTidy` does that once the teacher has chosen.
 */
export async function suggestTidyBatch(
  db: Database,
  teacherId: string,
  options: {
    after?: string | null;
    fetchFn?: typeof fetch;
    askGemini?: AskGemini;
    onProgress?: (progress: TidyProgress) => void;
    /**
     * What a run through the whole library has already suggested, not yet applied. Its series
     * and author spellings count as the library's own, after the library's, so a series named
     * in the first batch is named the same way in the last.
     */
    pending?: TidySuggestion[];
  } = {},
): Promise<TidyBatch> {
  const mine = eq(books.teacherId, teacherId);
  const batch: TidyBook[] = (await db
    .select(bookFields)
    .from(books)
    .where(and(mine, options.after ? gt(books.id, options.after) : undefined))
    .orderBy(asc(books.id))
    .limit(TIDY_BATCH)).map(tidyBook);
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
  for (const { title, patch } of options.pending ?? []) {
    if (!patch.series) continue;
    const name = [...known.keys()].find((existing) => looseSeriesKey(existing) === looseSeriesKey(patch.series!.name)) ?? patch.series.name;
    const entry = known.get(name) ?? { name, books: [] };
    entry.books.push({ title: patch.title ?? title, number: patch.series.number });
    known.set(name, entry);
  }

  const knownAuthors = await libraryAuthorSpellings(db, teacherId);
  for (const { patch } of options.pending ?? []) {
    for (const name of patch.authors ?? []) if (!knownAuthors.includes(name)) knownAuthors.push(name);
  }
  const fetchFn = options.fetchFn ?? fetch;
  const genreNames = (await listGenres(db, teacherId)).map((genre) => genre.name);
  const { readingLevelSystem } = await getTeacherSettings(db, teacherId);
  const [catalogue, answers] = await Promise.all([
    Promise.all(batch.map((book) => catalogueFacts(db, book, options.fetchFn))),
    (options.askGemini ?? askGemini)(batch, { series: [...known.values()], authors: knownAuthors, genres: genreNames, readingLevelSystem }, fetchFn, options.onProgress),
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
    const suggestion = screenSuggestion(book, { catalogue: facts, gemini, knownSeries: knownNames, genres: genreNames, readingLevels: readingLevelSystem !== "none" });
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
  const open = (field: TrackedField) => !book.locked.includes(field);
  const missing =
    (book.authors.length === 0 && open("authors")) ||
    (!book.series && open("series")) ||
    FILLABLE.some((field) => field !== "readingLevel" && open(field) && (book[field] === null || book[field] === ""));
  if (!missing) return {};
  const facts: CatalogueFacts = {};
  const options = fetchFn ? { fetchFn } : {};
  try {
    if (book.isbn13) {
      const found = await lookupIsbn(db, book.isbn13, options);
      if (found.status === "found") {
        Object.assign(facts, factsOf(found.metadata));
        // An answer cached before series were read has no `series` key: unknown, not "no series".
        // Open Library is asked about that edition again, and an outage there is just no series.
        if (found.metadata.series === undefined && !book.series && open("series")) {
          const series = await lookupSeries(book.isbn13, options).catch((error) => {
            if (error instanceof LookupUnavailableError) return null;
            throw error;
          });
          if (series) facts.series = series;
        }
      }
    }
    if (!book.isbn13 || (!book.coverUrl && !facts.coverUrl)) {
      const match = await matchSpine({ title: book.title, author: book.authors[0] ?? null }, fetchFn);
      const exact = match.candidates.find((candidate) => candidate.confidence === "exact" && (book.isbn13 ? candidate.coverUrl : true));
      if (exact && book.isbn13) {
        facts.coverUrl = exact.coverUrl;
        facts.searched = ["coverUrl"];
      } else if (exact) {
        // No ISBN of its own: the details of the edition the search matched, offered, never applied unasked.
        const found = await lookupIsbn(db, exact.isbn13, options);
        const matched = found.status === "found" ? factsOf(found.metadata) : {};
        if (!matched.coverUrl && exact.coverUrl) matched.coverUrl = exact.coverUrl;
        Object.assign(facts, matched);
        facts.searched = Object.keys(matched).filter((key) => (matched as Record<string, unknown>)[key] != null) as CatalogueFacts["searched"];
      }
    }
  } catch (error) {
    console.warn(`Tidy: catalogue facts unavailable for a book: ${(error as Error).message}`);
  }
  return facts;
}

function factsOf(metadata: {
  subtitle?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  authors?: string[];
  series?: string | null;
  seriesNumber?: number | null;
}): CatalogueFacts {
  const { subtitle, description, coverUrl, publisher, publishedYear, pageCount, authors, series, seriesNumber } = metadata;
  const facts = Object.fromEntries(
    Object.entries({ subtitle, description, coverUrl, publisher, publishedYear, pageCount, authors }).filter(([, value]) => value != null),
  ) as CatalogueFacts;
  if (series) facts.series = { name: series, number: seriesNumber ?? null };
  return facts;
}

/**
 * Applies the changes a teacher chose. Each is checked again against the book as it is now,
 * so a book edited since the suggestion was made keeps its edits, and the rules in
 * `src/lib/tidy.ts` hold however the request was made. Returns how many books changed.
 */
export async function applyTidy(
  db: Database,
  teacherId: string,
  changes: { bookId: string; patch: TidyPatch; sources?: TidySuggestion["sources"] }[],
  /** When given, every field changed is logged under this batch so it can be undone. */
  options: { batchId?: string } = {},
): Promise<number> {
  if (changes.length === 0) return 0;
  const current = await db
    .select(bookFields)
    .from(books)
    .where(and(eq(books.teacherId, teacherId), inArray(books.id, changes.map((change) => change.bookId))));
  const byId = new Map(current.map((row) => [row.id, { book: tidyBook(row), sources: readSources(row.fieldSources) }]));
  const genreIds = new Map((await db.select({ id: genres.id, name: genres.name }).from(genres).where(eq(genres.teacherId, teacherId))).map((genre) => [genre.name.toLowerCase(), genre.id]));

  let changed = 0;
  for (const change of changes) {
    const found = byId.get(change.bookId);
    if (!found) continue;
    const { book, sources } = found;
    const kept = stillApplies(book, change.patch);
    const { series, genre, tags, ...rest } = kept;
    const fields: Partial<typeof books.$inferInsert> = { ...rest };
    // Remember who said each field, so the card can say so and a later pass knows it wasn't the teacher.
    const origin: Record<string, string> = { ...sources };
    for (const key of Object.keys(kept) as (keyof TidyPatch)[]) {
      // A series records its own source when it is set, below.
      if (key === "series") continue;
      const source = change.sources?.[key];
      if (source) origin[key === "genre" ? "genreId" : key] = source;
    }
    if (Object.keys(fields).length > 0 || tags || genre) fields.fieldSources = origin;
    if (tags) fields.tags = normalizeTags(tags);
    if (genre) {
      const id = genreIds.get(genre.toLowerCase());
      if (id) fields.genreId = id;
    }
    let touched = false;
    const logged: LoggedChange[] = [];
    if (Object.keys(fields).length > 0) {
      await db.update(books).set(fields).where(and(eq(books.id, book.id), eq(books.teacherId, teacherId)));
      touched = true;
      for (const field of changeFields) {
        if (field in fields && field !== "series" && field !== "seriesNumber") {
          logged.push({ bookId: book.id, field, from: book[field as keyof TidyBook], to: (fields as Record<string, unknown>)[field] });
        }
      }
    }
    const setSeries = series ? await setSeriesIfMissing(db, teacherId, book.id, series, change.sources?.series) : null;
    if (setSeries) {
      touched = true;
      logged.push({ bookId: book.id, field: "series", from: book.series, to: setSeries.name });
      logged.push({ bookId: book.id, field: "seriesNumber", from: book.seriesNumber, to: setSeries.number });
    }
    if (options.batchId) await logChanges(db, teacherId, options.batchId, logged);
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
          genre: { type: "STRING", nullable: true },
          readingLevel: { type: "STRING", nullable: true },
          tags: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
          sure: { type: "BOOLEAN" },
        },
        required: ["n", "sure"],
      },
    },
  },
  required: ["books"],
} as const;

const LEVEL_FORMATS: Record<ReadingLevelSystem, string> = {
  none: "",
  lexile: 'a Lexile measure such as "720L"',
  guided_reading: 'a Fountas & Pinnell Guided Reading letter such as "N"',
  atos: 'an ATOS book level such as "4.5"',
  grade_level: 'a grade level such as "3"',
  other: "a short reading level",
};

function prompt(batch: TidyBook[], { series: known, authors, genres: genreNames, readingLevelSystem }: LibraryContext): string {
  const lines = batch.map((book, index) =>
    [
      `${index + 1}. Title: ${book.title}`,
      book.subtitle ? `   Subtitle: ${book.subtitle}` : null,
      `   Authors: ${book.authors.join("; ") || "(none recorded)"}`,
      book.isbn13 ? `   ISBN: ${book.isbn13}` : null,
      book.publisher || book.publishedYear ? `   Edition: ${[book.publisher, book.publishedYear].filter(Boolean).join(", ")}` : null,
      `   Series: ${book.series ? `${book.series}${book.seriesNumber !== null ? `, book ${book.seriesNumber}` : ""}` : "(none recorded)"}`,
      book.description ? null : "   Needs a description.",
      book.genreId || genreNames.length === 0 ? null : "   Needs a genre.",
      book.readingLevel || readingLevelSystem === "none" ? null : "   Needs a reading level.",
      book.tags.length ? null : "   Needs tags.",
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
- genre: only for a book marked "Needs a genre". Exactly one of the library's own genres, spelled as listed, and only if one clearly fits; null if none does. The genres are: ${genreNames.join("; ") || "(none)"}.
- readingLevel: only for a book marked "Needs a reading level"${readingLevelSystem === "none" ? "" : `, ${LEVEL_FORMATS[readingLevelSystem]}`}. Only if you actually know this book's level; null otherwise, never an estimate from the title alone.
- tags: only for a book marked "Needs tags": up to five short themes or topics readers would search by, such as "friendship" or "World War II". No genres and no ages.
- sure: true only if you are certain of every field you gave. A book you don't recognise gets nulls and sure false. Never guess.

Books:
${lines.join("\n")}
${series.length ? `\nSeries already in this library:\n${series.join("\n")}` : ""}${
    authors.length ? `\n\nAuthors already in this library, as they are spelled there:\n${authors.slice(0, 300).join("; ")}` : ""
  }`;
}

/** One request to Gemini for the whole batch. Answers come back in the batch's order. */
export async function askGemini(
  batch: TidyBook[],
  library: LibraryContext,
  fetchFn: typeof fetch = fetch,
  onProgress?: (progress: TidyProgress) => void,
): Promise<GeminiAnswer[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TidyUnavailableError("GEMINI_API_KEY is not set.", "unconfigured");
  let model = configuredModel();
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt(batch, library) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
      // Thought summaries keep the stream moving while the model thinks; they're never read.
      thinkingConfig: { ...thinkingLevel(), includeThoughts: true },
    },
  });

  const started = Date.now();
  const elapsed = () => `${model}, ${Date.now() - started}ms`;
  let response: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      // Streamed, so a long answer arrives as it's written rather than all at once or not at all.
      response = await fetchFn(streamUrl(ENDPOINT, model, apiKey), {
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

  let raw: string;
  try {
    let answered = 0;
    ({ text: raw } = await readGeminiStream(response, {
      idleMs: GEMINI_IDLE_MS,
      onText: (_delta, soFar) => {
        // Each book's answer opens with its number, "n", so a new one is a book more.
        const count = Math.min(countKeys(soFar, "n"), batch.length);
        if (count !== answered) onProgress?.({ answered: (answered = count), total: batch.length });
      },
    }));
  } catch (error) {
    throw new TidyUnavailableError(`Stream failed mid-answer (${elapsed()}): ${(error as Error).message}`, "busy");
  }
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
