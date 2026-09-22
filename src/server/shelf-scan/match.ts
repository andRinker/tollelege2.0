import "server-only";
import type { SpineReading } from "./vision";

/**
 * How much a catalogue record looks like what was read off the spine.
 *
 * - `exact` — title matches and nothing about the author contradicts it.
 * - `close` — the same work, probably a different edition or subtitle.
 * - `weak`  — found something, but a teacher should not trust it unread.
 */
export type MatchConfidence = "exact" | "close" | "weak";

export type MatchCandidate = {
  isbn13: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  confidence: MatchConfidence;
};

export type SpineMatch = {
  reading: SpineReading;
  /** Best first. Empty when nothing in either catalogue resembled the spine. */
  candidates: MatchCandidate[];
};

const SEARCH_TIMEOUT_MS = 8000;
const CANDIDATES_PER_SPINE = 3;
const RESULTS_PER_SOURCE = 5;

/** Strips everything that varies between catalogue records for the same book. */
function compareKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|of|in|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): Set<string> {
  return new Set(compareKey(value).split(" ").filter(Boolean));
}

type TitleAgreement = "exact" | "close" | "none";

function compareTitles(read: string, candidate: string): TitleAgreement {
  const left = compareKey(read);
  const right = compareKey(candidate);
  if (!left || !right) return "none";
  if (left === right) return "exact";
  // One side carrying a subtitle the other omits is still the same book.
  if (right.startsWith(left) || left.startsWith(right)) return "close";
  const readWords = words(read);
  const shared = [...words(candidate)].filter((word) => readWords.has(word)).length;
  return shared / Math.max(readWords.size, 1) >= 0.7 ? "close" : "none";
}

/**
 * Spines print authors every which way — "LOCKE BERKELEY HUME", "C.S. LEWIS",
 * "John Henry Cardinal Newman" — so this only asks whether any word is shared.
 * That is enough to catch a title that matched the wrong book: a shelf copy of
 * "The Empiricists" by Locke, Berkeley and Hume should not quietly become
 * "Kant and the Empiricists" by someone else entirely.
 */
function compareAuthors(read: string | null, candidates: string[]): "agrees" | "disagrees" | "unknown" {
  if (!read || candidates.length === 0) return "unknown";
  const readWords = [...words(read)].filter((word) => word.length > 2);
  if (readWords.length === 0) return "unknown";
  const candidateWords = new Set(candidates.flatMap((name) => [...words(name)]));
  return readWords.some((word) => candidateWords.has(word)) ? "agrees" : "disagrees";
}

function gradeMatch(reading: SpineReading, title: string, authors: string[]): MatchConfidence | null {
  const titleAgreement = compareTitles(reading.title, title);
  if (titleAgreement === "none") return null;
  const authorAgreement = compareAuthors(reading.author, authors);
  if (titleAgreement === "exact") {
    // A perfect title over a contradicting author is the shape a wrong book takes.
    return authorAgreement === "disagrees" ? "close" : "exact";
  }
  return authorAgreement === "agrees" ? "close" : "weak";
}

/**
 * Whether a spine reading and an existing record are plausibly the same work. Looser than
 * an `exact` grade on purpose: this decides whether to offer a copy of a book the teacher
 * already owns, where a different printing of the same title is exactly what we want to catch.
 */
export function looksLikeSameBook(reading: SpineReading, title: string, authors: string[]): boolean {
  if (compareTitles(reading.title, title) === "none") return false;
  return compareAuthors(reading.author, authors) !== "disagrees";
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown | null> {
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    return response.ok ? await response.json() : null;
  } catch {
    // A search that fails is one fewer suggestion, never a failed scan.
    return null;
  }
}

type RawCandidate = { isbn13: string; title: string; authors: string[]; coverUrl: string | null };

async function searchGoogleBooks(reading: SpineReading, fetchFn: typeof fetch): Promise<RawCandidate[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) return [];
  const terms = [`intitle:"${reading.title}"`, reading.author ? `inauthor:"${reading.author}"` : ""].filter(Boolean);
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms.join("+"))}` +
    `&maxResults=${RESULTS_PER_SOURCE}&key=${encodeURIComponent(apiKey)}`;
  const data = (await getJson(url, fetchFn)) as {
    items?: {
      volumeInfo?: {
        title?: string;
        authors?: string[];
        industryIdentifiers?: { type?: string; identifier?: string }[];
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
      };
    }[];
  } | null;

  const found: RawCandidate[] = [];
  for (const item of data?.items ?? []) {
    const info = item.volumeInfo;
    const isbn13 = info?.industryIdentifiers?.find((id) => id.type === "ISBN_13")?.identifier;
    if (!info?.title || !isbn13 || !/^97[89]\d{10}$/.test(isbn13)) continue;
    const thumbnail = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
    found.push({
      isbn13,
      title: info.title,
      authors: info.authors ?? [],
      coverUrl: thumbnail ? thumbnail.replace(/^http:/, "https:").replace("&edge=curl", "") : null,
    });
  }
  return found;
}

async function searchOpenLibrary(reading: SpineReading, fetchFn: typeof fetch): Promise<RawCandidate[]> {
  const params = new URLSearchParams({
    title: reading.title,
    limit: String(RESULTS_PER_SOURCE),
    fields: "title,author_name,isbn,cover_i",
  });
  if (reading.author) params.set("author", reading.author);
  const data = (await getJson(`https://openlibrary.org/search.json?${params}`, fetchFn)) as {
    docs?: { title?: string; author_name?: string[]; isbn?: string[]; cover_i?: number }[];
  } | null;

  const found: RawCandidate[] = [];
  for (const doc of data?.docs ?? []) {
    const isbn13 = (doc.isbn ?? []).find((value) => /^97[89]\d{10}$/.test(value));
    if (!doc.title || !isbn13) continue;
    found.push({
      isbn13,
      title: doc.title,
      authors: doc.author_name ?? [],
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    });
  }
  return found;
}

const CONFIDENCE_ORDER: Record<MatchConfidence, number> = { exact: 0, close: 1, weak: 2 };

/**
 * Turns one spine reading into real books a teacher could add. Several candidates are
 * kept deliberately: a classic like the Inferno exists in dozens of editions, and the
 * one on the shelf is rarely whichever a search happens to rank first.
 */
export async function matchSpine(reading: SpineReading, fetchFn: typeof fetch = fetch): Promise<SpineMatch> {
  const [google, openLibrary] = await Promise.all([
    searchGoogleBooks(reading, fetchFn),
    searchOpenLibrary(reading, fetchFn),
  ]);

  const byIsbn = new Map<string, MatchCandidate>();
  for (const raw of [...google, ...openLibrary]) {
    const confidence = gradeMatch(reading, raw.title, raw.authors);
    if (!confidence) continue;
    const existing = byIsbn.get(raw.isbn13);
    if (existing && CONFIDENCE_ORDER[existing.confidence] <= CONFIDENCE_ORDER[confidence]) {
      // Keep the better-graded record, but take a cover from whichever source has one.
      if (!existing.coverUrl && raw.coverUrl) existing.coverUrl = raw.coverUrl;
      continue;
    }
    byIsbn.set(raw.isbn13, {
      isbn13: raw.isbn13,
      title: raw.title,
      authors: raw.authors,
      coverUrl: raw.coverUrl ?? existing?.coverUrl ?? null,
      confidence,
    });
  }

  const candidates = [...byIsbn.values()]
    .sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence])
    .slice(0, CANDIDATES_PER_SPINE);

  return { reading, candidates };
}
