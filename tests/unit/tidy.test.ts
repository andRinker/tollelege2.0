import { describe, expect, it } from "vitest";
import { acceptableCover, sameAuthors, sameTitle, screenSuggestion, splitAutomatic, stillApplies, type TidyBook } from "@/lib/tidy";

function book(overrides: Partial<TidyBook> = {}): TidyBook {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    isbn13: "9780007627080",
    title: "Lion, the Witch And The Wardrobe",
    subtitle: null,
    authors: ["Clive Staples Lewis"],
    description: "Four children find a world in a wardrobe.",
    coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
    publisher: "Collins",
    publishedYear: 2000,
    pageCount: 186,
    series: null,
    seriesNumber: null,
    readingLevel: null,
    tags: [],
    genreId: null,
    locked: [],
    ...overrides,
  };
}

describe("sameTitle", () => {
  it("allows case, punctuation and a leading article to change, and nothing else", () => {
    expect(sameTitle("Lion, the Witch And The Wardrobe", "The Lion, the Witch and the Wardrobe")).toBe(true);
    expect(sameTitle("Frog & Toad Together", "Frog and Toad Together")).toBe(true);
    expect(sameTitle("Lion, the Witch And The Wardrobe", "Prince Caspian")).toBe(false);
    expect(sameTitle("Wonder", "Wonderland")).toBe(false);
  });
});

describe("sameAuthors", () => {
  it("allows the same people, named differently, in the same order", () => {
    expect(sameAuthors(["Clive Staples Lewis"], ["C. S. Lewis"])).toBe(true);
    expect(sameAuthors(["Arnold Lobel"], ["Mo Willems"])).toBe(false);
    expect(sameAuthors(["Clements", "Selznick"], ["Brian Selznick", "Andrew Clements"])).toBe(false);
    expect(sameAuthors([], ["C. S. Lewis"])).toBe(false);
  });
});

describe("acceptableCover", () => {
  it("takes https covers from the catalogues only", () => {
    expect(acceptableCover("https://covers.openlibrary.org/b/id/8-M.jpg")).toBe(true);
    expect(acceptableCover("https://books.google.com/books/content?id=x")).toBe(true);
    expect(acceptableCover("http://covers.openlibrary.org/b/id/8-M.jpg")).toBe(false);
    expect(acceptableCover("https://example.com/cover.jpg")).toBe(false);
    expect(acceptableCover("not a url")).toBe(false);
  });
});

describe("screenSuggestion", () => {
  it("offers a series in the library's spelling, a tidier title and the cover's name for the author", () => {
    const suggestion = screenSuggestion(book(), {
      gemini: { title: "The Lion, the Witch and the Wardrobe", authors: ["C. S. Lewis"], series: "Chronicles of Narnia", seriesNumber: 2, sure: true },
      knownSeries: ["The Chronicles of Narnia"],
    });
    expect(suggestion?.patch).toEqual({
      title: "The Lion, the Witch and the Wardrobe",
      authors: ["C. S. Lewis"],
      series: { name: "The Chronicles of Narnia", number: 2 },
    });
    expect(suggestion?.sure).toBe(true);
  });

  it("takes a catalogue's series over Gemini's, in the library's spelling, and applies it unasked", () => {
    const suggestion = screenSuggestion(book(), {
      catalogue: { series: { name: "Chronicles of Narnia", number: 2 } },
      gemini: { series: "Narnia", seriesNumber: 5, sure: false },
      knownSeries: ["The Chronicles of Narnia"],
    });
    expect(suggestion?.patch.series).toEqual({ name: "The Chronicles of Narnia", number: 2 });
    expect(suggestion?.sources.series).toBe("catalogue");
    expect(splitAutomatic(suggestion!).automatic.series).toEqual({ name: "The Chronicles of Narnia", number: 2 });
  });

  it("offers a series found by title search for review, and leaves a locked one alone", () => {
    const searched = screenSuggestion(book(), { catalogue: { series: { name: "Narnia", number: 1 }, searched: ["series"] } });
    expect(searched?.sources.series).toBe("search");
    expect(splitAutomatic(searched!).automatic).toEqual({});
    expect(screenSuggestion(book({ locked: ["series"] }), { catalogue: { series: { name: "Narnia", number: 1 } } })).toBeNull();
  });

  it("never turns a book into another, or replaces a series already set", () => {
    const suggestion = screenSuggestion(book({ series: "Narnia", seriesNumber: 2 }), {
      gemini: { title: "Prince Caspian", authors: ["J. R. R. Tolkien"], series: "Middle-earth", seriesNumber: 1, sure: true },
    });
    expect(suggestion).toBeNull();
  });

  it("fills only blank fields, from the catalogue first, and marks Gemini's guesses unsure", () => {
    const suggestion = screenSuggestion(book({ description: null, coverUrl: null, pageCount: null, publisher: "Collins" }), {
      catalogue: { description: "From the catalogue.", coverUrl: "https://covers.openlibrary.org/b/id/9-M.jpg", pageCount: 208, publisher: "HarperCollins" },
      gemini: { description: "From Gemini.", sure: false },
    });
    expect(suggestion?.patch).toEqual({
      description: "From the catalogue.",
      coverUrl: "https://covers.openlibrary.org/b/id/9-M.jpg",
      pageCount: 208,
    });
    expect(suggestion?.sure).toBe(true);

    const fromGemini = screenSuggestion(book({ description: null }), { gemini: { description: "From Gemini.", sure: false } });
    expect(fromGemini?.patch).toEqual({ description: "From Gemini." });
    expect(fromGemini?.sources).toEqual({ description: "gemini" });
    expect(fromGemini?.sure).toBe(false);
  });

  it("gives a book with no authors the catalogue's", () => {
    const suggestion = screenSuggestion(book({ authors: [] }), { catalogue: { authors: ["C. S. Lewis"] }, gemini: { authors: ["Someone Else"] } });
    expect(suggestion?.patch.authors).toEqual(["C. S. Lewis"]);
    expect(suggestion?.sources.authors).toBe("catalogue");
  });

  it("refuses a cover from anywhere but the catalogues", () => {
    expect(screenSuggestion(book({ coverUrl: null }), { catalogue: { coverUrl: "https://example.com/x.jpg" } })).toBeNull();
  });
});

describe("stillApplies", () => {
  it("drops what no longer holds against the book as it is now", () => {
    const now = book({ series: "The Chronicles of Narnia", pageCount: 200 });
    expect(
      stillApplies(now, {
        title: "The Lion, the Witch and the Wardrobe",
        authors: ["Somebody Else"],
        series: { name: "Narnia", number: 2 },
        pageCount: 186,
        coverUrl: "https://example.com/x.jpg",
      }),
    ).toEqual({ title: "The Lion, the Witch and the Wardrobe" });
  });
});

describe("genre, reading level and tags", () => {
  const blank = () => book({ description: null });
  const gemini = { genre: "fantasy", readingLevel: "790L", tags: ["Friendship", "friendship", "Magic"], sure: true };

  it("offers a genre only from the teacher's own list, spelled as theirs, and only when blank", () => {
    const found = screenSuggestion(blank(), { gemini, genres: ["Fantasy", "Nonfiction"], readingLevels: true });
    expect(found?.patch).toMatchObject({ genre: "Fantasy", readingLevel: "790L", tags: ["Friendship", "Magic"] });
    expect(found?.sources.genre).toBe("gemini");
    expect(screenSuggestion(blank(), { gemini: { genre: "Cooking" }, genres: ["Fantasy"] })).toBeNull();
    expect(screenSuggestion(book({ genreId: "g", tags: ["x"], readingLevel: "N" }), { gemini, genres: ["Fantasy"], readingLevels: true })).toBeNull();
  });

  it("ignores a reading level when the teacher doesn't track them", () => {
    expect(screenSuggestion(blank(), { gemini: { readingLevel: "790L" }, readingLevels: false })).toBeNull();
  });

  it("re-checks all three when applying", () => {
    expect(stillApplies(book({ genreId: "g", tags: ["x"], readingLevel: "N" }), { genre: "Fantasy", tags: ["a"], readingLevel: "M" })).toEqual({});
    expect(stillApplies(book(), { genre: "Fantasy", tags: ["a"], readingLevel: "M" })).toEqual({ genre: "Fantasy", tags: ["a"], readingLevel: "M" });
  });
});

describe("splitAutomatic", () => {
  it("applies catalogue facts for the ISBN and leaves Gemini's and search matches for review", () => {
    const suggestion = {
      bookId: "b",
      title: "T",
      authors: [],
      coverUrl: null,
      patch: { pageCount: 200, publisher: "Collins", description: "Gemini's", genre: "Fantasy", subtitle: "Found by search" },
      sources: { pageCount: "catalogue", publisher: "catalogue", description: "gemini", genre: "gemini", subtitle: "search" },
      sure: false,
    } as const;
    const { automatic, review } = splitAutomatic(suggestion as never);
    expect(automatic).toEqual({ pageCount: 200, publisher: "Collins" });
    expect(review?.patch).toEqual({ description: "Gemini's", genre: "Fantasy", subtitle: "Found by search" });
    expect(splitAutomatic({ ...suggestion, patch: { pageCount: 200 }, sources: { pageCount: "catalogue" } } as never).review).toBeNull();
  });
});

describe("fields a teacher has set", () => {
  const gemini = { title: "The Lion, the Witch and the Wardrobe", description: "A blurb.", genre: "Fantasy", tags: ["magic"], sure: true };

  it("are never suggested, even when blank", () => {
    const blank = book({ description: null, locked: ["description", "title", "genreId", "tags"] });
    expect(screenSuggestion(blank, { gemini, genres: ["Fantasy"] })).toBeNull();
    expect(screenSuggestion(book({ description: null }), { gemini, genres: ["Fantasy"] })?.patch.description).toBe("A blurb.");
  });

  it("are never applied, even from a suggestion made before the edit", () => {
    expect(stillApplies(book({ description: null, locked: ["description"] }), { description: "A blurb." })).toEqual({});
  });
});
