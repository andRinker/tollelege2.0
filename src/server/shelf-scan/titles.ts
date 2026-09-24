/**
 * Comparing titles and names as a spine prints them against how a catalogue, or another
 * reading of the same spine, writes them. Free of server imports, since the reader's merge
 * and the catalogue matching both need it.
 */

/** Strips everything that varies between records of the same book: case, punctuation, little words. */
export function compareKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|of|in|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(value: string): Set<string> {
  return new Set(compareKey(value).split(" ").filter(Boolean));
}

/**
 * Spines print authors every which way — "LOCKE BERKELEY HUME", "C.S. LEWIS",
 * "John Henry Cardinal Newman" — so this only asks whether any word is shared.
 * That is enough to catch a title that matched the wrong book: a shelf copy of
 * "The Empiricists" by Locke, Berkeley and Hume should not quietly become
 * "Kant and the Empiricists" by someone else entirely.
 */
export function compareAuthors(read: string | null, candidates: string[]): "agrees" | "disagrees" | "unknown" {
  if (!read || candidates.length === 0) return "unknown";
  const readWords = [...words(read)].filter((word) => word.length > 2);
  if (readWords.length === 0) return "unknown";
  const candidateWords = new Set(candidates.flatMap((name) => [...words(name)]));
  return readWords.some((word) => candidateWords.has(word)) ? "agrees" : "disagrees";
}

/** Single-character edits between two words, stopping early once it passes `limit`. */
function editsBetween(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    if (Math.min(...current) > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

/**
 * The same title read with a letter wrong: "Rise of the Jumbles" for "Rise of the Jumbies".
 * Same words in the same order, each differing by at most one letter and only in words long
 * enough that one letter can't turn them into another common word, and at least one word
 * read exactly right, so a one-word title ("Holes", "Hole") has to be read exactly.
 */
export function nearlySameTitle(left: string, right: string): boolean {
  const a = compareKey(left).split(" ").filter(Boolean);
  const b = compareKey(right).split(" ").filter(Boolean);
  if (a.length === 0 || a.length !== b.length) return false;
  if (!a.some((word, index) => word === b[index])) return false;
  return a.every((word, index) => word === b[index] || (word.length >= 5 && editsBetween(word, b[index], 1) <= 1));
}

/** Two readings of one spine: the same title once punctuation, case and a stray letter are set aside. */
export function sameTitle(left: string, right: string): boolean {
  return compareKey(left) === compareKey(right) || nearlySameTitle(left, right);
}

/**
 * The first of several names on a spine. Picture books and illustrated novels print two,
 * "Clements/Selznick", and a catalogue files the book under the first; searching for both
 * as one author finds nothing at all.
 */
export function leadAuthor(author: string | null): string | null {
  if (!author) return null;
  const first = author.split(/\s*(?:\/|&|;|\+|\band\b|\bwith\b|\billustrated by\b)\s*/i).find((part) => part.trim());
  return first?.trim() || null;
}

/**
 * Whether what was legible on an unreadable spine is consistent with a title: every word of
 * the fragment starts a word of the title, in order. "THE WA SAVED" fits "The War That Saved
 * My Life". Two words at least, so a lone "The" or a publisher's name can't fit anything.
 */
export function fragmentFits(fragment: string, title: string): boolean {
  const pieces = compareKey(fragment).split(" ").filter(Boolean);
  if (pieces.length < 2 || pieces.join("").length < 5) return false;
  const titleWords = compareKey(title).split(" ").filter(Boolean);
  let at = 0;
  for (const piece of pieces) {
    while (at < titleWords.length && !titleWords[at].startsWith(piece)) at++;
    if (at === titleWords.length) return false;
    at++;
  }
  return true;
}
