import "server-only";
import { type MatchCandidate, type SpineMatch, matchSpine } from "./match";
import { readSpines } from "./vision";

export type { MatchCandidate, MatchConfidence, SpineMatch } from "./match";
export type { SpineReading } from "./vision";
export { shelfScanConfigured, ShelfScanUnavailableError } from "./vision";

/** Catalogue searches run in parallel, but not sixty at once. */
const CONCURRENCY = 6;

export type ShelfScan = {
  /** One entry per spine the reader could make out, in shelf order. */
  matches: SpineMatch[];
  /** Spines that were read but matched nothing — these need a barcode scan instead. */
  unmatched: number;
};

async function inBatches<In, Out>(items: In[], size: number, run: (item: In) => Promise<Out>): Promise<Out[]> {
  const results: Out[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return results;
}

/**
 * Reads a shelf photo and proposes books for it.
 *
 * Nothing here writes to the catalogue. Everything it returns is a suggestion for a
 * teacher to confirm, because a title read correctly is still routinely the wrong
 * edition — and a wrong book added silently is worse than a book left out.
 */
export async function scanShelf(
  image: { data: ArrayBuffer; mimeType: string },
  fetchFn: typeof fetch = fetch,
): Promise<ShelfScan> {
  const readings = await readSpines(image, fetchFn);
  if (readings.length === 0) return { matches: [], unmatched: 0 };

  const matches = await inBatches(readings, CONCURRENCY, (reading) => matchSpine(reading, fetchFn));
  return {
    matches,
    unmatched: matches.filter((match) => match.candidates.length === 0).length,
  };
}

/** The suggestion a teacher sees first, or null when nothing matched that spine. */
export function bestCandidate(match: SpineMatch): MatchCandidate | null {
  return match.candidates[0] ?? null;
}
