import type { BookMetadata } from "./sources";

const MAX_AUTHORS = 5;

// "King, Jr." must not become "Jr. King".
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|md|ed|eds)\.?$/i;

/** Turns a library catalogue's "West, Christopher" into "Christopher West". */
function uninvertName(name: string): string {
  const parts = name.match(/^([^,]+),\s*([^,]+)$/);
  if (!parts) return name;
  const [, family, given] = parts;
  if (NAME_SUFFIX.test(given.trim())) return name;
  return `${given.trim()} ${family.trim()}`;
}

/**
 * A comparison key only — never displayed. Case, spacing and full stops all vary
 * between catalogue records for the same person, so "J.K. Rowling", "J. K. Rowling"
 * and "Rowling, J. K." all reduce to the same key.
 */
function identity(name: string): string {
  return name.toLowerCase().replace(/[.\s]/g, "");
}

/**
 * Open Library often lists one person twice, once per format — the record for
 * "Theology of the Body Explained" carries both "West, Christopher" and
 * "Christopher West". Uninverting first means the two collapse into one entry,
 * and the spelling that arrived first wins.
 */
export function normalizeAuthors(names: readonly string[]): string[] {
  const byIdentity = new Map<string, string>();
  for (const raw of names) {
    const name = uninvertName(raw.replace(/\s+/g, " ").trim());
    if (!name) continue;
    const key = identity(name);
    if (key && !byIdentity.has(key)) byIdentity.set(key, name);
  }
  return [...byIdentity.values()].slice(0, MAX_AUTHORS);
}

/**
 * Combines what each source is good at. Google Books records come from publisher
 * feeds, so titles and author names arrive properly cased and without duplicates.
 * Open Library records come from library catalogues, which carry the better edition
 * detail: publisher, page count, cover and blurb. Asking only the first source to
 * answer meant a book could be catalogued as "Theology of the body explained" by two
 * Christopher Wests while a clean record sat unread in the other source.
 *
 * Neither argument is required; with one source this still normalizes its authors.
 */
export function mergeMetadata(
  openLibrary: BookMetadata | null,
  googleBooks: BookMetadata | null,
): BookMetadata | null {
  if (!openLibrary && !googleBooks) return null;

  const naming = googleBooks ?? openLibrary!;
  const edition = openLibrary ?? googleBooks!;

  // Taken wholesale rather than concatenated: library records sometimes list editors
  // and translators as authors, and merging the lists would reintroduce that noise.
  const preferredAuthors = naming.authors?.length ? naming.authors : (edition.authors ?? []);

  return {
    isbn13: naming.isbn13,
    title: naming.title,
    subtitle: naming.subtitle ?? edition.subtitle,
    authors: normalizeAuthors(preferredAuthors),
    description: edition.description ?? naming.description,
    coverUrl: edition.coverUrl ?? naming.coverUrl,
    publisher: edition.publisher ?? naming.publisher,
    publishedYear: edition.publishedYear ?? naming.publishedYear,
    pageCount: edition.pageCount ?? naming.pageCount,
    // Records which source named the book, since that is the one a teacher would recognise.
    source: naming.source,
  };
}
