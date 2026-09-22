import "server-only";
import { type MatchCandidate, type SpineMatch, matchSpine } from "./match";
import { findOwned, type OwnedBook, type OwnedCandidate } from "./owned";
import { readSpines } from "./vision";

export type { MatchCandidate, MatchConfidence, SpineMatch } from "./match";
export type { OwnedBook, OwnedCandidate } from "./owned";
export type { SpineReading } from "./vision";
export { shelfScanConfigured, ShelfScanUnavailableError } from "./vision";

/** Catalogue searches run in parallel, but not sixty at once. */
const CONCURRENCY = 6;

/** A matched spine, plus the book the teacher already owns for it. */
export type ShelfProposal = SpineMatch & { owned: OwnedBook | null };

/** What a shelf photo may be, wherever it arrives from — a server action or a paired phone. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoProblem = { message: string } | null;

/** The one place that decides whether an uploaded file is a usable shelf photo. */
export function checkPhoto(photo: unknown): { data: File; mimeType: (typeof PHOTO_TYPES)[number] } | { error: string } {
  if (!(photo instanceof File)) return { error: "Choose a photo of a shelf." };
  if (photo.size === 0) return { error: "That photo was empty." };
  if (photo.size > MAX_PHOTO_BYTES) return { error: "That photo is too large. Try again with a single shelf." };
  const mimeType = PHOTO_TYPES.find((type) => type === photo.type);
  if (!mimeType) return { error: "Photos need to be JPEG, PNG or WebP." };
  return { data: photo, mimeType };
}

export type ShelfScan = {
  /** One entry per spine the reader could make out, in shelf order. */
  proposals: ShelfProposal[];
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
  options: { owned?: readonly OwnedCandidate[]; fetchFn?: typeof fetch } = {},
): Promise<ShelfScan> {
  const fetchFn = options.fetchFn ?? fetch;
  const owned = options.owned ?? [];

  const readings = await readSpines(image, fetchFn);
  if (readings.length === 0) return { proposals: [], unmatched: 0 };

  const matches = await inBatches(readings, CONCURRENCY, (reading) => matchSpine(reading, fetchFn));
  const proposals = matches.map((match) => ({ ...match, owned: findOwned(match, owned) }));
  return {
    proposals,
    unmatched: proposals.filter((proposal) => proposal.candidates.length === 0).length,
  };
}

/** The suggestion a teacher sees first, or null when nothing matched that spine. */
export function bestCandidate(match: SpineMatch): MatchCandidate | null {
  return match.candidates[0] ?? null;
}
