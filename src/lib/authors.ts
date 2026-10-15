/**
 * One spelling per author across a library. Catalogues name the same person differently:
 * Open Library's "Clive Staples Lewis", Google's "C. S. Lewis", a third record's "C.S. Lewis".
 * A library that keeps all three shows the same author three ways, so a book being added, or
 * tidied, takes the spelling the library already uses for that person.
 */

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;

/** A name's parts, lowercased, with initials split ("C.S." is "c", "s") and suffixes dropped. */
function parts(name: string): { given: string[]; surname: string } {
  const tokens = name
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[\s.,]+/)
    .map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean);
  while (tokens.length > 1 && SUFFIX.test(tokens.at(-1)!)) tokens.pop();
  return { given: tokens.slice(0, -1), surname: tokens.at(-1) ?? "" };
}

const compatible = (a: string, b: string) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

/**
 * Whether two spellings name the same person: the same surname, and as many given names, each
 * the same or an initial of the other. "Clive Staples Lewis", "C. S. Lewis" and "C.S. Lewis" are
 * one person; "C. Lewis" and "Lewis Carroll" are not, since a guess there merges two authors.
 */
export function samePerson(a: string, b: string): boolean {
  const left = parts(a);
  const right = parts(b);
  if (!left.surname || left.surname !== right.surname) return false;
  if (left.given.length !== right.given.length) return false;
  return left.given.every((name, index) => compatible(name, right.given[index]));
}

/** Whether two spellings differ only in case, spacing and full stops: "C.S. Lewis" and "C. S. Lewis". */
export function sameSpelling(a: string, b: string): boolean {
  const key = (name: string) => name.toLowerCase().replace(/[.\s]/g, "");
  return key(a) === key(b);
}

/**
 * The library's spelling of an author, or the name as given when the library has none.
 * `known` is the library's spellings, most used first, so the commonest wins a tie.
 */
export function librarySpelling(name: string, known: readonly string[]): string {
  return known.find((spelling) => samePerson(spelling, name)) ?? name;
}

/** Each author in the library's spelling, with any listed twice once. */
export function unifyAuthors(names: readonly string[], known: readonly string[]): string[] {
  const unified: string[] = [];
  for (const name of names) {
    const spelling = librarySpelling(name, known);
    if (!unified.some((existing) => samePerson(existing, spelling))) unified.push(spelling);
  }
  return unified;
}
