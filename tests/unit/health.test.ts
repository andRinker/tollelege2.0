import { describe, expect, it } from "vitest";
import { type HealthBook, libraryHealth } from "@/lib/health";

const full = (id: string, overrides: Partial<HealthBook> = {}): HealthBook => ({
  id,
  isbn13: "9780000000000",
  authors: ["C. S. Lewis"],
  description: "A book.",
  coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
  publisher: "Collins",
  publishedYear: 2000,
  pageCount: 200,
  readingLevel: "N",
  tags: ["magic"],
  genreId: "g",
  series: "The Chronicles of Narnia",
  ...overrides,
});

describe("libraryHealth", () => {
  it("counts what's missing and what's unsettled, and the share that's complete", () => {
    const health = libraryHealth(
      [
        full("1"),
        full("2"),
        full("3", { description: null, genreId: null, readingLevel: null, isbn13: null }),
        full("4", { series: "Chronicles of Narnia", authors: ["Clive Staples Lewis"] }),
        full("5", { tags: [], readingLevel: null, pageCount: null, publisher: null, publishedYear: null }),
      ],
      { readingLevels: true },
    );
    expect(health.books).toBe(5);
    expect(health.missing).toMatchObject({ description: 1, genre: 1, readingLevel: 2, cover: 0, tags: 1 });
    expect(health.noIsbn).toBe(1);
    expect(health.unsettledSeries).toBe(1);
    expect(health.unsettledAuthors).toBe(1);
    // Book 5 lacks only tags, level, pages, publisher and year, which don't hold it back.
    expect(health.completePercent).toBe(60);
  });

  it("ignores reading levels the teacher doesn't track, and an empty library is complete", () => {
    expect(libraryHealth([full("1", { readingLevel: null })], { readingLevels: false })).toMatchObject({ completePercent: 100, missing: { readingLevel: null } });
    expect(libraryHealth([], { readingLevels: false }).completePercent).toBe(100);
  });
});
