/**
 * How complete and consistent a library's metadata is, counted without a server so the Settings
 * card and the tests share one definition of "missing" and "unsettled".
 */
import { planReconcile } from "./reconcile";

export type HealthBook = {
  id: string;
  isbn13: string | null;
  authors: string[];
  description: string | null;
  coverUrl: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  readingLevel: string | null;
  tags: string[];
  genreId: string | null;
  series: string | null;
};

export type LibraryHealth = {
  books: number;
  /** Books missing each field. Reading level is counted only when the teacher tracks them. */
  missing: { description: number; cover: number; publisher: number; year: number; pages: number; genre: number; tags: number; readingLevel: number | null; authors: number };
  /** Books with no ISBN, which only a title search can enrich. */
  noIsbn: number;
  /** Books whose series, or authors, would be respelled by "Settle series and author spellings". */
  unsettledSeries: number;
  unsettledAuthors: number;
  /**
   * Books with the fields that make a library sorted and named (author, description, cover and
   * genre), and one spelling of every series and author, as a share of the library, 0 to 100.
   * Tags, reading level, pages, publisher and year are counted above but don't hold a book back,
   * since a catalogue often has none of them and nothing could ever fill them.
   */
  completePercent: number;
};

/** The gaps that keep a book from being sorted and named. */
const CORE: (keyof LibraryHealth["missing"])[] = ["authors", "description", "cover", "genre"];

const blank = (value: string | null) => value === null || value.trim() === "";

export function libraryHealth(library: readonly HealthBook[], { readingLevels }: { readingLevels: boolean }): LibraryHealth {
  const changes = planReconcile(library);
  const unsettledSeries = new Set(changes.filter((change) => change.field === "series").map((change) => change.bookId));
  const unsettledAuthors = new Set(changes.filter((change) => change.field === "authors").map((change) => change.bookId));

  const missing = { description: 0, cover: 0, publisher: 0, year: 0, pages: 0, genre: 0, tags: 0, authors: 0, readingLevel: readingLevels ? 0 : null } as LibraryHealth["missing"];
  let complete = 0;
  let noIsbn = 0;
  for (const book of library) {
    const gaps = [
      blank(book.description) && "description",
      blank(book.coverUrl) && "cover",
      blank(book.publisher) && "publisher",
      book.publishedYear === null && "year",
      book.pageCount === null && "pages",
      !book.genreId && "genre",
      book.tags.length === 0 && "tags",
      book.authors.length === 0 && "authors",
      readingLevels && blank(book.readingLevel) && "readingLevel",
    ].filter(Boolean) as (keyof LibraryHealth["missing"])[];
    for (const gap of gaps) (missing[gap] as number) += 1;
    if (!book.isbn13) noIsbn += 1;
    const core = !gaps.some((gap) => CORE.includes(gap));
    if (core && !unsettledSeries.has(book.id) && !unsettledAuthors.has(book.id)) complete += 1;
  }
  return {
    books: library.length,
    missing,
    noIsbn,
    unsettledSeries: unsettledSeries.size,
    unsettledAuthors: unsettledAuthors.size,
    completePercent: library.length === 0 ? 100 : Math.floor((complete / library.length) * 100),
  };
}
