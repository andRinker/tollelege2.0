/**
 * Series names and numbers. Pure, so the library, the lookup and the tests share one idea of
 * what "the same series" means.
 */

export type ParsedSeries = { name: string; number: number | null };

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

/**
 * Library catalogues write series in sentence case ("The 39 clues"), as they do titles, so
 * each word but the small ones gets a capital. Capitals already there are kept.
 */
function tidyCase(name: string): string {
  return name
    .split(" ")
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Reads an Open Library series statement into a name and a place in it:
 * "The 39 clues ; bk. 1", "Beyond the Spiderwick chronicles -- 1", "Magic tree house ; #1",
 * "(Harry Potter ; 7)". Returns null for anything that leaves no name.
 */
export function parseSeries(raw: string | null | undefined): ParsedSeries | null {
  if (!raw) return null;
  let text = raw.replace(/\s+/g, " ").trim().replace(/^\((.*)\)$/, "$1").trim();
  let number: number | null = null;

  const numbered = text.match(/^(.*?)(?:\s*(?:;|--|,|:)\s*|\s+)(?:(?:bk|book|no|number|v|vol|volume|pt|part)\.?\s*|#\s*)?(\d{1,4}(?:\.\d+)?)\.?$/i);
  if (numbered && numbered[1].trim()) {
    text = numbered[1];
    number = Number(numbered[2]);
  } else {
    // A statement with no number still often carries a trailing separator.
    text = text.replace(/\s*(;|--|,)\s*$/, "");
  }
  const name = text.replace(/^[\s.;,:-]+|[\s.;,:-]+$/g, "").trim();
  if (!name || /^\d+$/.test(name)) return null;
  return { name: tidyCase(name).slice(0, 120), number: number !== null && number <= 9999 ? number : null };
}

/** What two spellings of one series have in common: case, spacing and a leading article ignored. */
export function seriesKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

/** "3", "1.5", or "" for none, as a form shows it. */
export function formatSeriesNumber(number: number | null | undefined): string {
  if (number === null || number === undefined) return "";
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
}
