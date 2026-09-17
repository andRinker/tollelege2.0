import { APP_NAME } from "@/lib/brand";
import type { CachedBookMetadata } from "@/db/schema/isbn-cache";

export type BookMetadata = CachedBookMetadata;
export type Fetch = typeof fetch;

const TIMEOUT_MS = 5000;

/** Thrown when a source can't be reached, so the result isn't cached as "not found". */
export class LookupUnavailableError extends Error {}

function userAgent() {
  const contact = process.env.OPENLIBRARY_CONTACT;
  return `${APP_NAME.replace(/\s+/g, "")}/0.1${contact ? ` (${contact})` : ""}`;
}

async function getJson(fetchFn: Fetch, url: string): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (error) {
    throw new LookupUnavailableError(`Request failed: ${(error as Error).message}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new LookupUnavailableError(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json();
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
    return value.value.trim() || null;
  }
  return null;
}

function year(value: unknown): number | null {
  if (typeof value === "number" && value > 1000 && value < 3000) return value;
  const match = typeof value === "string" ? value.match(/\b(1[5-9]\d\d|20\d\d)\b/) : null;
  return match ? Number(match[1]) : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

type OpenLibraryEdition = {
  title?: string;
  subtitle?: string;
  authors?: { key: string }[];
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  covers?: number[];
  description?: string | { value: string };
};

type OpenLibrarySearch = {
  docs?: {
    title?: string;
    subtitle?: string;
    author_name?: string[];
    cover_i?: number;
    first_publish_year?: number;
    number_of_pages_median?: number;
    publisher?: string[];
  }[];
};

export async function fetchOpenLibrary(isbn13: string, fetchFn: Fetch = fetch): Promise<BookMetadata | null> {
  const fields = "key,title,subtitle,author_name,cover_i,first_publish_year,number_of_pages_median,publisher";
  const [edition, search] = (await Promise.all([
    getJson(fetchFn, `https://openlibrary.org/isbn/${isbn13}.json`),
    getJson(fetchFn, `https://openlibrary.org/search.json?isbn=${isbn13}&fields=${fields}&limit=1`),
  ])) as [OpenLibraryEdition | null, OpenLibrarySearch | null];

  const doc = search?.docs?.[0];
  const title = text(edition?.title) ?? text(doc?.title);
  if (!title) return null;

  let authors = (doc?.author_name ?? []).map((name) => name.trim()).filter(Boolean);
  if (authors.length === 0 && edition?.authors?.length) {
    const records = await Promise.all(
      edition.authors.slice(0, 3).map((author) => getJson(fetchFn, `https://openlibrary.org${author.key}.json`).catch(() => null)),
    );
    authors = records.map((record) => text((record as { name?: string } | null)?.name)).filter((name): name is string => Boolean(name));
  }

  const coverId = edition?.covers?.find((id) => id > 0) ?? doc?.cover_i;
  return {
    isbn13,
    title,
    subtitle: text(edition?.subtitle) ?? text(doc?.subtitle),
    authors: authors.slice(0, 5),
    description: text(edition?.description),
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null,
    publisher: text(edition?.publishers?.[0]) ?? text(doc?.publisher?.[0]),
    // Edition dates are more reliable than the work's "first published" year.
    publishedYear: year(edition?.publish_date) ?? year(doc?.first_publish_year),
    pageCount: positiveInt(edition?.number_of_pages) ?? positiveInt(doc?.number_of_pages_median),
    source: "openlibrary",
  };
}

type GoogleBooksResponse = {
  items?: {
    volumeInfo?: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      description?: string;
      publisher?: string;
      publishedDate?: string;
      pageCount?: number;
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }[];
};

export async function fetchGoogleBooks(isbn13: string, apiKey: string, fetchFn: Fetch = fetch): Promise<BookMetadata | null> {
  const data = (await getJson(
    fetchFn,
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&key=${encodeURIComponent(apiKey)}`,
  )) as GoogleBooksResponse | null;
  const info = data?.items?.[0]?.volumeInfo;
  const title = text(info?.title);
  if (!info || !title) return null;

  const thumbnail = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
  return {
    isbn13,
    title,
    subtitle: text(info.subtitle),
    authors: (info.authors ?? []).slice(0, 5),
    description: text(info.description),
    coverUrl: thumbnail ? thumbnail.replace(/^http:/, "https:").replace("&edge=curl", "") : null,
    publisher: text(info.publisher),
    publishedYear: year(info.publishedDate),
    pageCount: positiveInt(info.pageCount),
    source: "google_books",
  };
}
