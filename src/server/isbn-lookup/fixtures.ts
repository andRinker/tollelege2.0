import type { Fetch } from "./sources";

type Fixture = { edition: object | null; search: object };

/** Canned Open Library responses for end-to-end tests. Anything else is "not found". */
const FIXTURES: Record<string, Fixture> = {
  "9780064440202": {
    edition: {
      title: "Frog and Toad Are Friends",
      publishers: ["HarperTrophy"],
      publish_date: "October 3, 1979",
      covers: [51292],
      number_of_pages: 64,
    },
    search: { docs: [{ title: "Frog and Toad Are Friends", author_name: ["Arnold Lobel"], cover_i: 51292 }] },
  },
  "9780439708180": {
    edition: {
      title: "Harry Potter and the Sorcerer's Stone",
      publishers: ["Scholastic"],
      publish_date: "1999",
      covers: [14656855],
      number_of_pages: 309,
    },
    search: { docs: [{ title: "Harry Potter and the Philosopher's Stone", author_name: ["J. K. Rowling"] }] },
  },
  "9780545010221": {
    edition: { title: "Harry Potter and the Deathly Hallows", publishers: ["Arthur A. Levine Books"], publish_date: "2007", number_of_pages: 759 },
    search: { docs: [{ author_name: ["J. K. Rowling"] }] },
  },
  "9780062315007": {
    edition: { title: "The Alchemist", publishers: ["HarperOne"], publish_date: "2014", number_of_pages: 197 },
    search: { docs: [{ author_name: ["Paulo Coelho"] }] },
  },
  // A second printing of the same book, so a spine matched from a shelf photo can offer
  // more than one edition and still have both of them resolve to a real record.
  "9780061122415": {
    edition: { title: "The Alchemist", publishers: ["HarperCollins"], publish_date: "1993", number_of_pages: 208 },
    search: { docs: [{ author_name: ["Paulo Coelho"] }] },
  },
};

export function createFixtureFetch(): Fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const isbn = url.pathname.match(/\/isbn\/(\d{13})\.json$/)?.[1] ?? url.searchParams.get("isbn") ?? "";
    const fixture = FIXTURES[isbn];
    if (url.pathname.startsWith("/isbn/")) {
      return fixture?.edition
        ? Response.json(fixture.edition)
        : new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/search.json") {
      return Response.json(fixture?.search ?? { docs: [] });
    }
    return new Response("Not found", { status: 404 });
  }) as Fetch;
}
