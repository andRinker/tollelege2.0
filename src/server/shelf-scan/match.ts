import "server-only";
import { compareAuthors, compareKey, leadAuthor, nearlySameTitle, words } from "./titles";
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
/** An author search casts wider, since the title has to be picked out of their books. */
const AUTHOR_RESULTS = 20;

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
 * The ways a title read off a spine might be filed. "Beyond the Spiderwick Chronicles: The
 * Nixie's Song" is catalogued as "The Nixie's Song", so each part is tried on its own as well
 * as the whole.
 */
export function titleForms(title: string): string[] {
  const forms = [title];
  for (const part of title.split(/\s*[:;—–]\s*|\s+-\s+/)) {
    const key = compareKey(part);
    // A part worth searching for: a few letters at least, and not just "Book 2".
    if (key.replace(/\s/g, "").length >= 4 && !/^(book|volume|vol|part|no)\s*\d+$/.test(key) && !forms.includes(part)) {
      forms.push(part);
    }
  }
  return forms;
}

/**
 * How well a spine's title fits a record's, trying each part of the spine's title and the
 * record with its subtitle. Only the whole of what was read can be exact: a record that
 * matches one part of it is the same book at best, and a subtitled edition stays "close".
 */
function bestTitleAgreement(read: string, candidate: string, subtitle?: string | null): TitleAgreement {
  const candidates = subtitle ? [candidate, `${candidate}: ${subtitle}`] : [candidate];
  let best: TitleAgreement = "none";
  for (const left of titleForms(read)) {
    for (const right of candidates) {
      const agreement = compareTitles(left, right);
      if (agreement === "exact" && left === read) return "exact";
      if (agreement !== "none") best = "close";
    }
  }
  return best;
}

function gradeMatch(reading: SpineReading, title: string, authors: string[], subtitle?: string | null): MatchConfidence | null {
  const titleAgreement = bestTitleAgreement(reading.title, title, subtitle);
  const authorAgreement = compareAuthors(reading.author, authors);
  if (titleAgreement === "none") {
    // A letter misread ("Jumbles" for "Jumbies") is worth offering only when the author
    // backs it up, and even then as a book to check, never one ticked for the teacher.
    const nearly = titleForms(reading.title).some((form) => nearlySameTitle(form, title));
    return authorAgreement === "agrees" && nearly ? "weak" : null;
  }
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
  if (bestTitleAgreement(reading.title, title) === "none") return false;
  return compareAuthors(reading.author, authors) !== "disagrees";
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown | null> {
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Only the host: the URL carries the Google Books key. A 429 here means the day's quota
      // is spent, and every spine after it is being searched in one catalogue instead of two.
      console.warn(`Shelf scan: catalogue search refused by ${new URL(url).host} (HTTP ${response.status})`);
      return null;
    }
    return await response.json();
  } catch {
    // A search that fails is one fewer suggestion, never a failed scan.
    return null;
  }
}

type RawCandidate = { isbn13: string; title: string; subtitle: string | null; authors: string[]; coverUrl: string | null };

/** What to ask a catalogue for. Either may be left out, never both. */
type Query = { title: string | null; author: string | null };

async function searchGoogleBooks(query: Query, fetchFn: typeof fetch): Promise<RawCandidate[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) return [];
  const terms = [query.title ? `intitle:"${query.title}"` : "", query.author ? `inauthor:"${query.author}"` : ""].filter(Boolean);
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms.join("+"))}` +
    `&maxResults=${query.title ? RESULTS_PER_SOURCE : AUTHOR_RESULTS}&key=${encodeURIComponent(apiKey)}`;
  const data = (await getJson(url, fetchFn)) as {
    items?: {
      volumeInfo?: {
        title?: string;
        subtitle?: string;
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
      subtitle: info.subtitle ?? null,
      authors: info.authors ?? [],
      coverUrl: thumbnail ? thumbnail.replace(/^http:/, "https:").replace("&edge=curl", "") : null,
    });
  }
  return found;
}

async function searchOpenLibrary(query: Query, fetchFn: typeof fetch): Promise<RawCandidate[]> {
  const params = new URLSearchParams({
    limit: String(query.title ? RESULTS_PER_SOURCE : AUTHOR_RESULTS),
    fields: "title,subtitle,author_name,isbn,cover_i",
  });
  if (query.title) params.set("title", query.title);
  if (query.author) params.set("author", query.author);
  const data = (await getJson(`https://openlibrary.org/search.json?${params}`, fetchFn)) as {
    docs?: { title?: string; subtitle?: string; author_name?: string[]; isbn?: string[]; cover_i?: number }[];
  } | null;

  const found: RawCandidate[] = [];
  for (const doc of data?.docs ?? []) {
    const isbn13 = (doc.isbn ?? []).find((value) => /^97[89]\d{10}$/.test(value));
    if (!doc.title || !isbn13) continue;
    found.push({
      isbn13,
      title: doc.title,
      subtitle: doc.subtitle ?? null,
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
 *
 * Both catalogues are asked by title and the first author printed, and when that finds
 * nothing, asked again more loosely: by each part of a title printed with its series, by
 * title alone, since a spine's author is often printed oddly or read wrong, and then by
 * author alone, for a title with a letter misread.
 * A looser search only ever runs for a spine the stricter one couldn't place, and what it
 * finds is still graded against everything read off the spine.
 */
export async function matchSpine(reading: SpineReading, fetchFn: typeof fetch = fetch): Promise<SpineMatch> {
  const author = leadAuthor(reading.author);
  // The whole title first, then each part of one printed with its series.
  const forms = titleForms(reading.title).slice(0, 3);
  const queries: Query[] = forms.map((title) => ({ title, author }));
  if (author) queries.push(...forms.map((title) => ({ title, author: null })), { title: null, author });

  for (const query of queries) {
    const candidates = grade(reading, await searchBoth(query, fetchFn));
    if (candidates.length > 0) return { reading, candidates };
  }
  return { reading, candidates: [] };
}

async function searchBoth(query: Query, fetchFn: typeof fetch): Promise<RawCandidate[]> {
  const [google, openLibrary] = await Promise.all([searchGoogleBooks(query, fetchFn), searchOpenLibrary(query, fetchFn)]);
  return [...google, ...openLibrary];
}

function grade(reading: SpineReading, found: RawCandidate[]): MatchCandidate[] {
  const byIsbn = new Map<string, MatchCandidate>();
  for (const raw of found) {
    const confidence = gradeMatch(reading, raw.title, raw.authors, raw.subtitle);
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

  return [...byIsbn.values()]
    .sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence])
    .slice(0, CANDIDATES_PER_SPINE);
}
