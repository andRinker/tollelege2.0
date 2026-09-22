import "server-only";
import { looksLikeSameBook, type SpineMatch } from "./match";

/** The shape of an existing catalogue row, structurally matching `BookIdentity`. */
export type OwnedCandidate = {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  copies: number;
};

export type OwnedBook = {
  bookId: string;
  title: string;
  copies: number;
  /** How the match was made, which is what the teacher is told. */
  via: "isbn" | "title";
};

/**
 * Finds the book a teacher already owns for this spine, if any.
 *
 * Without this, photographing an already-catalogued shelf quietly produces a second row
 * for every book, because a different printing carries a different ISBN and the add path
 * matches on ISBN alone. A teacher reading their own library sees two "Charlotte's Web"
 * and no explanation.
 *
 * ISBN is checked first because it is certain. Falling back to title and author is a
 * judgement, so it is reported separately and never acted on without confirmation.
 */
export function findOwned(match: SpineMatch, owned: readonly OwnedCandidate[]): OwnedBook | null {
  const candidateIsbns = new Set(match.candidates.map((candidate) => candidate.isbn13));
  for (const book of owned) {
    if (book.isbn13 && candidateIsbns.has(book.isbn13)) {
      return { bookId: book.id, title: book.title, copies: book.copies, via: "isbn" };
    }
  }
  for (const book of owned) {
    if (looksLikeSameBook(match.reading, book.title, book.authors)) {
      return { bookId: book.id, title: book.title, copies: book.copies, via: "title" };
    }
  }
  return null;
}
