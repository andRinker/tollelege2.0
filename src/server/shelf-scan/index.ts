import "server-only";
import { type MatchCandidate, type SpineMatch, matchSpine } from "./match";
import { findOwned, type OwnedBook, type OwnedCandidate } from "./owned";
import { readSpines, type SpineReading } from "./vision";

export type { MatchCandidate, MatchConfidence, SpineMatch } from "./match";
export type { OwnedBook, OwnedCandidate } from "./owned";
export type { SpineReading, SpineSighting } from "./vision";
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

/**
 * One place on the shelf, left to right. Three states from one shape:
 *
 * - `proposal` set — a book to confirm.
 * - `reading` set, no `proposal` — the spine was read but no catalogue knew the title.
 * - no `reading` — the spine could be seen but not read; `fragment` holds whatever was.
 *
 * The last two are what the scan is admitting it couldn't finish, and both are fixable
 * by the teacher in seconds because the slot knows where on the shelf it sits.
 */
export type ShelfSlot = {
  /** Index in the row as the teacher sees it, left to right. */
  position: number;
  reading: SpineReading | null;
  fragment: string | null;
  proposal: ShelfProposal | null;
};

export type ShelfScan = {
  /** Every spine the reader saw, in shelf order — matched or not. */
  slots: ShelfSlot[];
  /** Slots with no book on them, which is the count worth telling a teacher. */
  needsAttention: number;
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
  const owned = options.owned ?? [];
  const fetchFn =
    options.fetchFn ??
    (process.env.SHELF_SCAN_FIXTURES === "1" ? (await import("./fixtures")).createShelfFixtureFetch() : fetch);

  const sightings = await readSpines(image, fetchFn);
  if (sightings.length === 0) return { slots: [], needsAttention: 0 };

  // Only the spines that were actually read cost a catalogue search; the rest already
  // know they need a human, and their place in the row is the useful thing about them.
  const readable = sightings.flatMap((sighting, index) => (sighting.reading ? [index] : []));
  const matches = await inBatches(readable, CONCURRENCY, (index) =>
    matchSpine(sightings[index].reading as SpineReading, fetchFn),
  );
  const matchAt = new Map(readable.map((index, nth) => [index, matches[nth]]));

  const slots: ShelfSlot[] = sightings.map((sighting, position) => {
    const match = matchAt.get(position);
    return {
      position,
      reading: sighting.reading,
      fragment: sighting.fragment,
      proposal: match && match.candidates.length > 0 ? { ...match, owned: findOwned(match, owned) } : null,
    };
  });

  return { slots, needsAttention: slots.filter((slot) => slot.proposal === null).length };
}

/** The suggestion a teacher sees first, or null when nothing matched that spine. */
export function bestCandidate(match: SpineMatch): MatchCandidate | null {
  return match.candidates[0] ?? null;
}
