import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { lookupIsbn } from "@/server/isbn-lookup";
import { mergeMetadata, normalizeAuthors } from "@/server/isbn-lookup/merge";
import type { BookMetadata } from "@/server/isbn-lookup/sources";
import { fetchGoogleBooks, fetchOpenLibrary, type Fetch } from "@/server/isbn-lookup/sources";
import { createTestDb, type TestDatabase } from "../helpers/test-db";

const fixture = (name: string) => readFileSync(path.join("tests/fixtures/isbn", name), "utf8");

/** Serves recorded Open Library responses keyed by URL pattern. */
function recordedFetch(isbn: string): Fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(`/isbn/${isbn}.json`)) return new Response(fixture(`openlibrary-edition-${isbn}.json`));
    if (url.includes("/search.json")) return new Response(fixture(`openlibrary-search-${isbn}.json`));
    return new Response("missing", { status: 404 });
  }) as Fetch;
}

describe("Open Library mapping", () => {
  it("combines edition details with author names from search", async () => {
    const metadata = await fetchOpenLibrary("9780064440202", recordedFetch("9780064440202"));
    expect(metadata).toMatchObject({
      isbn13: "9780064440202",
      title: "Frog and Toad Are Friends (I Can Read Book 2)",
      authors: ["Arnold Lobel"],
      publisher: "HarperTrophy",
      publishedYear: 1979,
      coverUrl: "https://covers.openlibrary.org/b/id/51292-M.jpg",
      source: "openlibrary",
    });
    expect(metadata?.pageCount).toBeGreaterThan(0);
  });

  it("returns null when neither endpoint knows the ISBN", async () => {
    const empty: Fetch = (async (input: RequestInfo | URL) =>
      String(input).includes("search.json") ? Response.json({ docs: [] }) : new Response("", { status: 404 })) as Fetch;
    expect(await fetchOpenLibrary("9780000000002", empty)).toBeNull();
  });

  it("looks up author records when search has no author names", async () => {
    const fetchFn: Fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/isbn/")) return Response.json({ title: "Owl at Home", authors: [{ key: "/authors/OL237115A" }] });
      if (url.includes("/authors/OL237115A")) return Response.json({ name: "Arnold Lobel" });
      return Response.json({ docs: [] });
    }) as Fetch;
    expect((await fetchOpenLibrary("9780064440349", fetchFn))?.authors).toEqual(["Arnold Lobel"]);
  });
});

describe("Google Books mapping", () => {
  it("maps volume info and upgrades thumbnails to https", async () => {
    const fetchFn: Fetch = (async () =>
      Response.json({
        items: [
          {
            volumeInfo: {
              title: "Wonder",
              authors: ["R. J. Palacio"],
              publisher: "Knopf",
              publishedDate: "2012-02-14",
              pageCount: 310,
              imageLinks: { thumbnail: "http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl" },
            },
          },
        ],
      })) as Fetch;
    const metadata = await fetchGoogleBooks("9780375869020", "key", fetchFn);
    expect(metadata).toMatchObject({ title: "Wonder", authors: ["R. J. Palacio"], publishedYear: 2012, pageCount: 310, source: "google_books" });
    expect(metadata?.coverUrl).toBe("https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1");
  });
});

describe("author names", () => {
  it("collapses one person listed in both inverted and plain form", () => {
    // Exactly what Open Library returns for 9780819874108.
    expect(normalizeAuthors(["West, Christopher", "Christopher West"])).toEqual(["Christopher West"]);
  });

  it("leaves a suffix alone rather than reading it as a given name", () => {
    expect(normalizeAuthors(["King, Jr."])).toEqual(["King, Jr."]);
  });

  it("treats spacing in initials as the same person", () => {
    expect(normalizeAuthors(["J. K. Rowling", "J.K. Rowling"])).toEqual(["J. K. Rowling"]);
  });

  it("drops blanks and caps the list at five", () => {
    expect(normalizeAuthors(["  ", "A One", "B Two", "C Three", "D Four", "E Five", "F Six"])).toHaveLength(5);
  });
});

describe("merging sources", () => {
  const openLibrary: BookMetadata = {
    isbn13: "9780819874108",
    title: "Theology of the body explained",
    subtitle: null,
    authors: ["West, Christopher", "Christopher West"],
    description: "A commentary on the Wednesday audiences.",
    coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
    publisher: "Pauline Books & Media",
    publishedYear: 2003,
    pageCount: 530,
    source: "openlibrary",
  };
  const googleBooks: BookMetadata = {
    isbn13: "9780819874108",
    title: "Theology of the Body Explained",
    subtitle: `A Commentary on John Paul II's "gospel of the Body"`,
    authors: ["Christopher West"],
    description: null,
    coverUrl: null,
    publisher: null,
    publishedYear: null,
    pageCount: null,
    source: "google_books",
  };

  it("names the book from Google Books and describes the edition from Open Library", () => {
    expect(mergeMetadata(openLibrary, googleBooks)).toMatchObject({
      title: "Theology of the Body Explained",
      subtitle: `A Commentary on John Paul II's "gospel of the Body"`,
      authors: ["Christopher West"],
      publisher: "Pauline Books & Media",
      pageCount: 530,
      publishedYear: 2003,
      description: "A commentary on the Wednesday audiences.",
      coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg",
      source: "google_books",
    });
  });

  it("still tidies the authors when only Open Library answers", () => {
    expect(mergeMetadata(openLibrary, null)?.authors).toEqual(["Christopher West"]);
  });

  it("falls back to Open Library's naming when Google Books has none", () => {
    expect(mergeMetadata(openLibrary, null)?.title).toBe("Theology of the body explained");
  });

  it("returns null when neither source knows the book", () => {
    expect(mergeMetadata(null, null)).toBeNull();
  });
});

describe("lookupIsbn", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("caches found books and serves repeat lookups without the network", async () => {
    const fetchFn = vi.fn(recordedFetch("9780439708180"));
    const first = await lookupIsbn(testDb.db, "9780439708180", { fetchFn });
    expect(first.status).toBe("found");
    const calls = fetchFn.mock.calls.length;

    const second = await lookupIsbn(testDb.db, "9780439708180", { fetchFn });
    expect(second).toEqual(first);
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it("caches not-found results for a day", async () => {
    const empty = vi.fn((async (input: RequestInfo | URL) =>
      String(input).includes("search.json") ? Response.json({ docs: [] }) : new Response("", { status: 404 })) as Fetch);
    const now = new Date("2026-09-01T12:00:00Z");
    expect(await lookupIsbn(testDb.db, "9780000000019", { fetchFn: empty, now })).toEqual({ status: "not_found" });
    const calls = empty.mock.calls.length;

    await lookupIsbn(testDb.db, "9780000000019", { fetchFn: empty, now: new Date("2026-09-01T20:00:00Z") });
    expect(empty.mock.calls.length).toBe(calls);

    await lookupIsbn(testDb.db, "9780000000019", { fetchFn: empty, now: new Date("2026-09-03T12:00:00Z") });
    expect(empty.mock.calls.length).toBeGreaterThan(calls);
  });

  it("still finds a book when one source is down", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-key");
    const fetchFn = vi.fn((async (input: RequestInfo | URL) => {
      if (String(input).includes("googleapis.com")) {
        return Response.json({ items: [{ volumeInfo: { title: "Wonder", authors: ["R. J. Palacio"] } }] });
      }
      throw new TypeError("fetch failed");
    }) as Fetch);

    expect(await lookupIsbn(testDb.db, "9780000000033", { fetchFn })).toMatchObject({
      status: "found",
      metadata: { title: "Wonder", authors: ["R. J. Palacio"] },
    });
    vi.unstubAllEnvs();
  });

  it("keeps nothing it learned while a source was down", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-key");
    // Google has spent its day's quota; Open Library doesn't know the ISBN.
    const halfDown = vi.fn((async (input: RequestInfo | URL) => {
      if (String(input).includes("googleapis.com")) return new Response("quota", { status: 429 });
      return String(input).includes("search.json") ? Response.json({ docs: [] }) : new Response("", { status: 404 });
    }) as Fetch);
    expect(await lookupIsbn(testDb.db, "9780689871313", { fetchFn: halfDown })).toEqual({ status: "unavailable" });

    // Tomorrow Google answers, and nothing cached stands in its way.
    const recovered = vi.fn((async (input: RequestInfo | URL) => {
      if (String(input).includes("googleapis.com")) {
        return Response.json({ items: [{ volumeInfo: { title: "The Nixie's Song", authors: ["Tony DiTerlizzi", "Holly Black"] } }] });
      }
      return String(input).includes("search.json") ? Response.json({ docs: [] }) : new Response("", { status: 404 });
    }) as Fetch);
    expect(await lookupIsbn(testDb.db, "9780689871313", { fetchFn: recovered })).toMatchObject({
      status: "found",
      metadata: { title: "The Nixie's Song" },
    });
    vi.unstubAllEnvs();
  });

  it("reports network failures as unavailable without caching them", async () => {
    const failing = vi.fn((async () => {
      throw new TypeError("fetch failed");
    }) as Fetch);
    expect(await lookupIsbn(testDb.db, "9780000000026", { fetchFn: failing })).toEqual({ status: "unavailable" });
    // The failure wasn't cached, so the next lookup reaches the (now working) network.
    const empty = vi.fn((async (input: RequestInfo | URL) =>
      String(input).includes("search.json") ? Response.json({ docs: [] }) : new Response("", { status: 404 })) as Fetch);
    expect((await lookupIsbn(testDb.db, "9780000000026", { fetchFn: empty })).status).toBe("not_found");
    expect(empty).toHaveBeenCalled();
  });
});
