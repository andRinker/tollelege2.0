import type { Availability, BookListFilters, BookSort } from "@/server/catalog";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseLibraryFilters(params: SearchParams): Required<Pick<BookListFilters, "availability" | "sort" | "page">> & BookListFilters {
  const availability = first(params.availability);
  const sort = first(params.sort);
  const page = Number(first(params.page));
  return {
    query: first(params.q)?.slice(0, 200) || undefined,
    availability: (["all", "available", "out"] as const).includes(availability as Availability) ? (availability as Availability) : "all",
    tag: first(params.tag) || undefined,
    readingLevel: first(params.level) || undefined,
    location: first(params.bin) || undefined,
    sort: (["title", "author", "recent"] as const).includes(sort as BookSort) ? (sort as BookSort) : "title",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
