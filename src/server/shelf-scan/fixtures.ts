import "server-only";
import type { SpineSighting } from "./vision";

/**
 * A canned shelf, for tests and for driving the review screen without a Gemini key.
 *
 * It is deliberately the awkward shelf rather than the tidy one: two spines nobody can
 * read side by side, one with a legible fragment, and a title the catalogues won't know.
 * A fixture where everything matches would never have shown the gap rows at all.
 */
export const FIXTURE_SHELF: SpineSighting[] = [
  { reading: { title: "The Alchemist", author: "Paulo Coelho" }, fragment: null },
  { reading: null, fragment: "The Mouse and the" },
  { reading: null, fragment: null },
  { reading: { title: "Harry Potter and the Deathly Hallows", author: "J. K. Rowling" }, fragment: null },
  { reading: { title: "Boxcar Children Special Edition", author: null }, fragment: null },
  { reading: null, fragment: null },
];

/**
 * Catalogue answers for the fixture shelf, keyed by the title the spine was read as.
 *
 * Every ISBN here must also be in `isbn-lookup/fixtures.ts`: confirming the shelf adds
 * each book through the ordinary ISBN lookup, and an edition only this file knows would
 * match fine and then fail to add.
 */
const FIXTURE_CATALOGUE: Record<string, { title: string; author_name: string[]; isbn: string[] }[]> = {
  // Two printings, since a spine read correctly is routinely the wrong edition.
  "the alchemist": [
    { title: "The Alchemist", author_name: ["Paulo Coelho"], isbn: ["9780062315007"] },
    { title: "The Alchemist", author_name: ["Paulo Coelho"], isbn: ["9780061122415"] },
  ],
  "harry potter and the deathly hallows": [
    { title: "Harry Potter and the Deathly Hallows", author_name: ["J. K. Rowling"], isbn: ["9780545010221"] },
  ],
  // "Boxcar Children Special Edition" is deliberately absent: a spine read perfectly well
  // that no catalogue knows is its own kind of miss, and the review has to show it.
};

/**
 * Stands in for the catalogue search while the reader is on fixtures, so a fixture shelf
 * comes back part matched and part not — which is the only interesting shape to test.
 */
export function createShelfFixtureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.hostname !== "openlibrary.org") return new Response("Not found", { status: 404 });
    const title = (url.searchParams.get("title") ?? "").toLowerCase();
    return Response.json({ docs: FIXTURE_CATALOGUE[title] ?? [] });
  }) as typeof fetch;
}
