import { type SpineSighting, spineKey } from "./vision";

/** A spine, and whether only the second look saw it. */
export type LookedSighting = SpineSighting & { secondLook: boolean };

/** Books on the shelf, counting every copy a folded row stands for. */
export function spinesSeen(sightings: readonly SpineSighting[]): number {
  return sightings.reduce((total, sighting) => total + sighting.copies, 0);
}

/**
 * Combines a first reading with a second look taken because it came up short of the
 * teacher's count.
 *
 * The second look is used only if it saw more, and then as the base, since it lists the
 * whole shelf in order again. Anything it saw that the first didn't is flagged, so the
 * review can start it unticked and say so: a count invites the reader to find more, and a
 * book found only under that pressure deserves a deliberate yes. Anything the first reading
 * read that the second dropped is put back beside whichever of its neighbours is nearer, so a second
 * look can add to the shelf but never take a book off it.
 */
export function mergeLooks(first: readonly SpineSighting[], second: readonly SpineSighting[]): LookedSighting[] {
  if (spinesSeen(second) <= spinesSeen(first)) return first.map((sighting) => ({ ...sighting, secondLook: false }));

  const firstCopies = new Map<string, number>();
  for (const sighting of first) {
    if (sighting.reading) firstCopies.set(spineKey(sighting.reading), sighting.copies);
  }
  // Unread spines have no title to pair them by, so the first reading's count of them is
  // what the second look is measured against.
  let unreadBefore = first.filter((sighting) => !sighting.reading).length;

  const merged: LookedSighting[] = second.map((sighting) => {
    if (!sighting.reading) {
      if (unreadBefore > 0) {
        unreadBefore -= 1;
        return { ...sighting, secondLook: false };
      }
      return { ...sighting, secondLook: true };
    }
    const before = firstCopies.get(spineKey(sighting.reading)) ?? 0;
    // More copies of a book the first reading already found are just more copies; only a
    // title it never saw is flagged, since that is what a count could talk the reader into.
    return { ...sighting, copies: Math.max(sighting.copies, before), secondLook: before === 0 };
  });

  const present = new Set(merged.flatMap((sighting) => (sighting.reading ? [spineKey(sighting.reading)] : [])));
  first.forEach((sighting, index) => {
    if (!sighting.reading || present.has(spineKey(sighting.reading))) return;
    merged.splice(placeFor(first, index, merged), 0, { ...sighting, secondLook: false });
    present.add(spineKey(sighting.reading));
  });
  return merged;
}

/**
 * Where a spine the second look dropped goes back: beside whichever readable neighbour
 * from the first reading stood nearer to it, after an earlier one or before a later one.
 */
function placeFor(first: readonly SpineSighting[], index: number, merged: readonly LookedSighting[]): number {
  const positionOf = (neighbour: SpineSighting) =>
    neighbour.reading ? merged.findIndex((row) => row.reading && spineKey(row.reading) === spineKey(neighbour.reading!)) : -1;
  for (let distance = 1; distance < first.length; distance++) {
    const earlier = first[index - distance];
    const before = earlier ? positionOf(earlier) : -1;
    if (before !== -1) return before + 1;
    const later = first[index + distance];
    const after = later ? positionOf(later) : -1;
    if (after !== -1) return after;
  }
  return merged.length;
}
