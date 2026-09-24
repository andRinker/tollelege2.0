import { compareAuthors, fragmentFits, sameTitle } from "./titles";
import type { SpineReading, SpineSighting } from "./vision";

/**
 * A spine, whether only the second look saw it, and, for a spine only partly read,
 * what was legible when its title was taken from the copy beside it.
 */
export type LookedSighting = SpineSighting & { secondLook: boolean; partial: string | null };

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
  if (spinesSeen(second) <= spinesSeen(first)) return first.map((sighting) => ({ ...sighting, secondLook: false, partial: null }));

  // Two readings of one spine rarely agree to the letter ("Jumbles" and "Jumbies", an
  // author printed once and missed once), so a book is recognised by its title, loosely.
  const inFirst = (reading: SpineReading) => first.find((sighting) => sighting.reading && sameTitle(sighting.reading.title, reading.title));
  // Unread spines have no title to pair them by, so the first reading's count of them is
  // what the second look is measured against.
  let unreadBefore = first.filter((sighting) => !sighting.reading).length;

  const merged: LookedSighting[] = second.map((sighting) => {
    if (!sighting.reading) {
      if (unreadBefore > 0) {
        unreadBefore -= 1;
        return { ...sighting, secondLook: false, partial: null };
      }
      return { ...sighting, secondLook: true, partial: null };
    }
    const before = inFirst(sighting.reading)?.copies ?? 0;
    // More copies of a book the first reading already found are just more copies; only a
    // title it never saw is flagged, since that is what a count could talk the reader into.
    return { ...sighting, copies: Math.max(sighting.copies, before), secondLook: before === 0, partial: null };
  });

  const present = (reading: SpineReading) => merged.some((row) => row.reading && sameTitle(row.reading.title, reading.title));
  first.forEach((sighting, index) => {
    if (!sighting.reading || present(sighting.reading)) return;
    merged.splice(placeFor(first, index, merged), 0, { ...sighting, secondLook: false, partial: null });
  });
  return merged;
}

/**
 * Tidies a reading before a teacher sees it, without adding a book to it.
 *
 * Copies standing side by side are one row, even when the reader listed them apart or
 * printed the author differently on each ("Sharon M. Draper", "DRAPER"): the row counts
 * both, and confirming it adds both.
 *
 * A spine it couldn't read, whose legible letters fit the title of the book right beside
 * it, is probably another copy with a sticker over it ("THE WA SAVED" next to "The War That
 * Saved My Life"). It is offered as that book, but flagged, and the review starts it
 * unticked: the reader's rule that a fragment is never a guess still holds, and this is a
 * suggestion for the teacher, who can see the spine, to accept.
 */
export function tidyShelf(sightings: readonly LookedSighting[]): LookedSighting[] {
  const folded: LookedSighting[] = [];
  for (const sighting of sightings) {
    const last = folded.at(-1);
    if (last?.reading && sighting.reading && sameCopy(last.reading, sighting.reading)) {
      folded[folded.length - 1] = {
        ...last,
        // The fuller author is the better one to search by.
        reading: (sighting.reading.author?.length ?? 0) > (last.reading.author?.length ?? 0) ? sighting.reading : last.reading,
        copies: last.copies + sighting.copies,
        // A copy only the second look saw makes the whole row one to check.
        secondLook: last.secondLook || sighting.secondLook,
      };
    } else {
      folded.push(sighting);
    }
  }

  return folded.map((sighting, index) => {
    if (sighting.reading || !sighting.fragment) return sighting;
    const beside = [folded[index - 1], folded[index + 1]].find(
      (neighbour) => neighbour?.reading && !neighbour.partial && fragmentFits(sighting.fragment!, neighbour.reading.title),
    );
    if (!beside?.reading) return sighting;
    return { ...sighting, reading: beside.reading, partial: sighting.fragment };
  });
}

function sameCopy(left: SpineReading, right: SpineReading): boolean {
  return sameTitle(left.title, right.title) && compareAuthors(left.author, right.author ? [right.author] : []) !== "disagrees";
}

/**
 * Where a spine the second look dropped goes back: beside whichever readable neighbour
 * from the first reading stood nearer to it, after an earlier one or before a later one.
 */
function placeFor(first: readonly SpineSighting[], index: number, merged: readonly LookedSighting[]): number {
  const positionOf = (neighbour: SpineSighting) =>
    neighbour.reading ? merged.findIndex((row) => row.reading && sameTitle(row.reading.title, neighbour.reading!.title)) : -1;
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
