/**
 * Saying where on the shelf a book the scanner couldn't finish actually sits.
 *
 * A count of what was missed is honest but useless on its own: a teacher holding it has
 * to re-read forty spines to find the two. A position turns the same information into an
 * instruction — walk to the gap between these two books and scan that one barcode.
 *
 * Deliberately pure and deliberately here rather than in `src/server/shelf-scan`, which
 * is server-only: the review list runs in the browser.
 */

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function quoted(title: string): string {
  return `“${title}”`;
}

/**
 * Describes slot `index` by its nearest confirmed neighbours.
 *
 * `titles` holds one entry per slot in shelf order: the title where the scan produced a
 * book, and null where it didn't. Everything is relative to that list, because that list
 * is exactly what the teacher has on screen — counting along it and counting along the
 * real shelf give the same answer.
 */
export function describeGap(titles: readonly (string | null)[], index: number): string {
  // A run of unfinished slots shares its neighbours, so "between X and Y" alone would
  // name three different books identically. Only blanks run together, though: a spine
  // that was read but matched nothing is already named by its own title, and counting it
  // into the run beside it would both mis-number that run and hide a real neighbour.
  let start = index;
  let end = index;
  if (titles[index] === null) {
    while (start > 0 && titles[start - 1] === null) start -= 1;
    while (end < titles.length - 1 && titles[end + 1] === null) end += 1;
  }

  const left = start > 0 ? titles[start - 1] : null;
  const right = end < titles.length - 1 ? titles[end + 1] : null;

  const place = left && right
    ? `between ${quoted(left)} and ${quoted(right)}`
    : left
      ? `after ${quoted(left)}`
      : right
        ? `before ${quoted(right)}`
        : `${ordinal(index + 1)} from the left`;

  const run = end - start + 1;
  if (run === 1 || (!left && !right)) return place;
  return `${ordinal(index - start + 1)} of ${run}, ${place}`;
}
