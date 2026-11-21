/**
 * Settling a library's spellings, decided without a server so the reconcile pass, the add path
 * and the tests share one rule. It is deterministic: only spellings that name the same series
 * (`looseSeriesKey`) or the same person (`samePerson`) are ever joined, so nothing here is a guess.
 */
import { samePerson } from "./authors";
import { looseSeriesKey } from "./series";

export type ReconcileBook = { id: string; series: string | null; authors: string[] };

/** One field of one book, from what it is to what it should be. */
export type ReconcileChange =
  | { bookId: string; field: "series"; from: string; to: string }
  | { bookId: string; field: "authors"; from: string[]; to: string[] };

/** The most used spelling wins; a tie goes to the fuller name, then the alphabetically first. */
function pickCanonical(counts: Map<string, number>): string {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0][0];
}

/** The library's spelling of a series, or the name as given when it has none like it. `known` counts books per spelling. */
export function settleSeries(name: string, known: ReadonlyMap<string, number>): string {
  const key = looseSeriesKey(name);
  const same = new Map([...known].filter(([spelling]) => looseSeriesKey(spelling) === key));
  return same.size > 0 ? pickCanonical(same) : name;
}

/** Every change that would give each series and each person one spelling across the library. */
export function planReconcile(library: readonly ReconcileBook[]): ReconcileChange[] {
  const changes: ReconcileChange[] = [];

  const seriesCounts = new Map<string, number>();
  for (const book of library) if (book.series) seriesCounts.set(book.series, (seriesCounts.get(book.series) ?? 0) + 1);
  const groups = new Map<string, Map<string, number>>();
  for (const [spelling, count] of seriesCounts) {
    const key = looseSeriesKey(spelling);
    groups.set(key, (groups.get(key) ?? new Map()).set(spelling, count));
  }
  const canonicalSeries = new Map<string, string>();
  for (const [key, spellings] of groups) canonicalSeries.set(key, pickCanonical(spellings));

  const authorCounts = new Map<string, number>();
  for (const book of library) for (const name of book.authors) authorCounts.set(name, (authorCounts.get(name) ?? 0) + 1);
  // Most used first, so a spelling joins the commonest one that names the same person.
  const spellings = [...authorCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])).map(([name]) => name);
  const canonicalAuthor = new Map<string, string>();
  const heads: string[] = [];
  for (const name of spellings) {
    const head = heads.find((existing) => samePerson(existing, name));
    if (head) canonicalAuthor.set(name, head);
    else {
      heads.push(name);
      canonicalAuthor.set(name, name);
    }
  }

  for (const book of library) {
    if (book.series) {
      const to = canonicalSeries.get(looseSeriesKey(book.series));
      if (to && to !== book.series) changes.push({ bookId: book.id, field: "series", from: book.series, to });
    }
    const unified: string[] = [];
    for (const name of book.authors) {
      const to = canonicalAuthor.get(name) ?? name;
      if (!unified.includes(to)) unified.push(to);
    }
    if (unified.join("\u0000") !== book.authors.join("\u0000")) changes.push({ bookId: book.id, field: "authors", from: book.authors, to: unified });
  }
  return changes;
}
