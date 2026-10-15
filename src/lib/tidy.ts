/**
 * What "Tidy my library" may change, decided without a server so the review screen, the
 * apply step and the tests share one rule. Gemini and the catalogues only ever propose; this
 * is what keeps a confident wrong answer from turning a book into a different one.
 *
 * - A title or author list may be rewritten only into the same words or the same people.
 * - Every other field is only ever filled when it is blank. Nothing a teacher set is replaced.
 */
import { parseSeries, seriesKey } from "./series";

export type TidyBook = {
  id: string;
  isbn13: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  coverUrl: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  series: string | null;
  seriesNumber: number | null;
};

/** The fields a tidy may fill when blank, beyond title, authors and series. */
export const FILLABLE = ["subtitle", "description", "coverUrl", "publisher", "publishedYear", "pageCount"] as const;
export type Fillable = (typeof FILLABLE)[number];

/** A change to one book. Only the fields that would change are present. */
export type TidyPatch = {
  title?: string;
  authors?: string[];
  series?: { name: string; number: number | null };
  subtitle?: string;
  description?: string;
  coverUrl?: string;
  publisher?: string;
  publishedYear?: number;
  pageCount?: number;
};

/** Where a suggested value came from, so the review can say so. */
export type TidySource = "catalogue" | "gemini";

/** A change a teacher is offered. */
export type TidySuggestion = {
  bookId: string;
  /** The book as it is now, for the review to show beside the change. */
  title: string;
  authors: string[];
  coverUrl: string | null;
  patch: TidyPatch;
  sources: Partial<Record<keyof TidyPatch, TidySource>>;
  /** False when anything in it is uncertain; those start unticked. */
  sure: boolean;
};

/** One book's answer from Gemini, before it is checked. */
export type GeminiAnswer = {
  title?: string | null;
  authors?: string[] | null;
  series?: string | null;
  seriesNumber?: number | null;
  description?: string | null;
  sure?: boolean;
};

/** Catalogue details for the same book: by its ISBN, or a cover from a search by title and author. */
export type CatalogueFacts = Partial<Pick<TidyBook, Fillable | "authors">>;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");

/**
 * The same title, written better: same words in the same order, with case, punctuation and a
 * leading "The" free to change. "Lion, the Witch And The Wardrobe" may become "The Lion, the
 * Witch and the Wardrobe"; it may never become "Prince Caspian".
 */
export function sameTitle(a: string, b: string): boolean {
  return words(a) !== "" && words(a) === words(b);
}

const surname = (name: string) => words(name).split(" ").at(-1) ?? "";

/**
 * The same people, named as their covers name them: as many authors, in the same order, each
 * with the same surname. "Clive Staples Lewis" may become "C. S. Lewis".
 */
export function sameAuthors(a: string[], b: string[]): boolean {
  return (
    a.length > 0 &&
    a.length === b.length &&
    a.every((name, index) => surname(name) !== "" && surname(name) === surname(b[index]))
  );
}

const COVER_HOSTS = ["covers.openlibrary.org", "books.google.com", "books.googleusercontent.com"];

/** A cover the app will show: https, from a catalogue it already loads covers from. */
export function acceptableCover(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && COVER_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

const LIMITS = { subtitle: 500, description: 5000, coverUrl: 1000, publisher: 300 } as const;

function fillableValue(field: Fillable, value: unknown): string | number | null {
  if (field === "publishedYear") return typeof value === "number" && Number.isInteger(value) && value > 1000 && value < 3000 ? value : null;
  if (field === "pageCount") return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 100_000 ? value : null;
  if (typeof value !== "string") return null;
  const text = field === "description" ? value.trim() : clean(value);
  if (!text) return null;
  if (field === "coverUrl" && !acceptableCover(text)) return null;
  return text.slice(0, LIMITS[field]);
}

/**
 * Turns what the catalogues and Gemini said about one book into what a teacher is offered,
 * or null when nothing survives. The catalogue is preferred for any field both answered,
 * since it describes the printing on the shelf and Gemini only knows the work.
 */
export function screenSuggestion(
  book: TidyBook,
  { catalogue = {}, gemini = {}, knownSeries = [] }: { catalogue?: CatalogueFacts; gemini?: GeminiAnswer; knownSeries?: string[] },
): TidySuggestion | null {
  const patch: TidyPatch = {};
  const sources: TidySuggestion["sources"] = {};

  const title = gemini.title ? clean(gemini.title).slice(0, 500) : "";
  if (title && title !== book.title && sameTitle(book.title, title)) {
    patch.title = title;
    sources.title = "gemini";
  }

  const authors = (gemini.authors ?? []).map(clean).filter(Boolean).slice(0, 10);
  const listed = (catalogue.authors ?? []).map(clean).filter(Boolean).slice(0, 10);
  if (book.authors.length === 0 && listed.length) {
    // A book catalogued without its authors gets the catalogue's for that ISBN, or else Gemini's.
    patch.authors = listed.map((name) => name.slice(0, 200));
    sources.authors = "catalogue";
  } else if (authors.length && authors.join("|") !== book.authors.join("|") && (book.authors.length === 0 || sameAuthors(book.authors, authors))) {
    patch.authors = authors.map((name) => name.slice(0, 200));
    sources.authors = "gemini";
  }

  if (!book.series && gemini.series) {
    const parsed = parseSeries(gemini.series);
    if (parsed) {
      const given = typeof gemini.seriesNumber === "number" && Number.isFinite(gemini.seriesNumber) ? gemini.seriesNumber : null;
      const number = given ?? parsed.number;
      const name = knownSeries.find((known) => seriesKey(known) === seriesKey(parsed.name)) ?? parsed.name;
      patch.series = { name, number: number !== null && number >= 0 && number <= 9999 ? number : null };
      sources.series = "gemini";
    }
  }

  for (const field of FILLABLE) {
    if (book[field] !== null && book[field] !== "") continue;
    const fromCatalogue = fillableValue(field, catalogue[field]);
    const fromGemini = field === "description" ? fillableValue(field, gemini.description) : null;
    const value = fromCatalogue ?? fromGemini;
    if (value === null) continue;
    (patch as Record<string, unknown>)[field] = value;
    sources[field] = fromCatalogue !== null ? "catalogue" : "gemini";
  }

  if (Object.keys(patch).length === 0) return null;
  // Catalogue facts are the record of this book; anything of Gemini's is only as sure as it said.
  const usesGemini = Object.values(sources).includes("gemini");
  return {
    bookId: book.id,
    title: book.title,
    authors: book.authors,
    coverUrl: book.coverUrl,
    patch,
    sources,
    sure: !usesGemini || gemini.sure === true,
  };
}

/**
 * The part of a chosen patch that still holds against the book as it is now, when it is
 * applied: someone may have edited the book since the suggestion was made, and a tampered
 * request must not get past the rules either. Empty when nothing still applies.
 */
export function stillApplies(book: TidyBook, patch: TidyPatch): TidyPatch {
  const kept: TidyPatch = {};
  if (patch.title && sameTitle(book.title, patch.title)) kept.title = clean(patch.title).slice(0, 500);
  if (patch.authors && (book.authors.length === 0 || sameAuthors(book.authors, patch.authors))) {
    const authors = patch.authors.map((name) => clean(name).slice(0, 200)).filter(Boolean).slice(0, 10);
    if (authors.length) kept.authors = authors;
  }
  if (patch.series && !book.series) {
    const name = clean(patch.series.name).slice(0, 120);
    const number = patch.series.number;
    if (name) kept.series = { name, number: number !== null && number >= 0 && number <= 9999 ? number : null };
  }
  for (const field of FILLABLE) {
    if (patch[field] === undefined || (book[field] !== null && book[field] !== "")) continue;
    const value = fillableValue(field, patch[field]);
    if (value !== null) (kept as Record<string, unknown>)[field] = value;
  }
  return kept;
}
