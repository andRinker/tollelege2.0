import "server-only";
import { type MatchCandidate, type SpineMatch, matchSpine } from "./match";
import { findOwned, type OwnedBook, type OwnedCandidate } from "./owned";
import { mergeLooks, spinesSeen } from "./second-look";
import { readShelf, type ShelfScanFailure, type SpineReading, ShelfScanUnavailableError } from "./vision";

export type { MatchCandidate, MatchConfidence, SpineMatch } from "./match";
export type { OwnedBook, OwnedCandidate } from "./owned";
export type { SpineReading, SpineSighting } from "./vision";
export { type ShelfScanFailure, shelfScanConfigured, ShelfScanUnavailableError } from "./vision";

/**
 * A scan runs inside one request, which the host stops at 120 seconds. The readings get
 * the first 95 of them, leaving the rest for matching every spine against the catalogues;
 * a second look only starts if enough is left for a thorough reading to finish.
 */
const READING_BUDGET_MS = 95_000;
const SECOND_LOOK_NEEDS_MS = 35_000;

/** What a teacher is told when the reader fails, by why it failed. */
export function describeShelfFailure(reason: ShelfScanFailure): string {
  switch (reason) {
    case "timeout":
      return "Reading that shelf took too long. Crop the photo to one shelf, or photograph fewer books at a time.";
    case "busy":
      return "The book reader is busy right now. Try again in a minute.";
    case "refused":
      return "The book reader turned the photo down. Try again; if it keeps happening, tell your administrator.";
    case "unreadable":
      return "The book reader's answer came back garbled. Try the photo again.";
    case "unconfigured":
      return "Shelf photos aren't set up on this site yet.";
  }
}
export { mergeLooks } from "./second-look";

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
  /** Identical spines this row stands for; confirming it adds that many copies. */
  copies: number;
  /** Seen only on a second look, after the teacher's count said the first missed some. */
  secondLook: boolean;
};

/**
 * The teacher's count against what the photo showed. `seen` counts every copy, so a shelf
 * with two of a book reads as two books, which is how the teacher counted it.
 */
export type ShelfTally = {
  /** Books the teacher said were on the shelf, or null when they didn't say. */
  expected: number | null;
  seen: number;
  /** Books the teacher counted that the photo showed no sign of. */
  missing: number;
  /** Books the second look added to the first reading's count. */
  foundOnSecondLook: number;
};

export type ShelfScan = {
  /** Every spine the reader saw, in shelf order — matched or not. */
  slots: ShelfSlot[];
  /** Slots with no book on them, which is the count worth telling a teacher. */
  needsAttention: number;
  tally: ShelfTally;
  /**
   * Spines the reader saw on other shelves in the frame and left out. Said out loud, so a
   * photo where it picked the wrong shelf is caught at once rather than trusted.
   */
  otherShelf: number;
};

/** A count a teacher could plausibly mean for one shelf, or null. */
export function parseShelfCount(value: unknown): number | null {
  const count = Number(typeof value === "string" ? value.trim() : value);
  return Number.isInteger(count) && count >= 1 && count <= 200 ? count : null;
}

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
  options: {
    owned?: readonly OwnedCandidate[];
    fetchFn?: typeof fetch;
    /** How many books the teacher counted on the shelf, if they did. */
    expected?: number | null;
  } = {},
): Promise<ShelfScan> {
  const owned = options.owned ?? [];
  const fetchFn =
    options.fetchFn ??
    (process.env.SHELF_SCAN_FIXTURES === "1" ? (await import("./fixtures")).createShelfFixtureFetch() : fetch);

  const expected = options.expected ?? null;
  const deadline = Date.now() + READING_BUDGET_MS;
  const { sightings: first, otherShelf: firstOther } = await readShelf(image, fetchFn, { expected, deadline });
  let sightings = mergeLooks(first, []);
  let otherShelf = firstOther;

  // Short of the teacher's count: one more look, with the first reading to go on. It is
  // best-effort, so a failure keeps the first reading rather than losing the whole scan.
  // An empty first reading is a photo with no shelf in it, and a count is no help there.
  if (expected !== null && first.length > 0 && spinesSeen(first) < expected && deadline - Date.now() >= SECOND_LOOK_NEEDS_MS) {
    try {
      const again = await readShelf(image, fetchFn, { again: { expected, previous: first }, deadline });
      sightings = mergeLooks(first, again.sightings);
      otherShelf = Math.max(otherShelf, again.otherShelf);
    } catch (error) {
      if (!(error instanceof ShelfScanUnavailableError)) throw error;
      console.warn(`Shelf scan second look unavailable: ${error.message}`);
    }
  }

  const seen = spinesSeen(sightings);
  const tally: ShelfTally = {
    expected,
    seen,
    missing: expected !== null ? Math.max(0, expected - seen) : 0,
    foundOnSecondLook: seen - spinesSeen(first),
  };
  if (sightings.length === 0) return { slots: [], needsAttention: 0, tally, otherShelf };

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
      copies: sighting.copies,
      secondLook: sighting.secondLook,
    };
  });

  return { slots, needsAttention: slots.filter((slot) => slot.proposal === null).length, tally, otherShelf };
}

/** The suggestion a teacher sees first, or null when nothing matched that spine. */
export function bestCandidate(match: SpineMatch): MatchCandidate | null {
  return match.candidates[0] ?? null;
}
