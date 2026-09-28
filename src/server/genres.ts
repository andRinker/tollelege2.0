import { and, asc, count, eq, max } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, type GenreColor, genres, teacherSettings } from "@/db/schema";
import { ConflictError, isUniqueViolation, NotFoundError } from "./errors";

export type Genre = { id: string; name: string; color: GenreColor; position: number; bookCount: number };

/**
 * The genres a teacher starts with: the common classroom scheme of coloured dots, where a colour
 * can stand for more than one genre. Every teacher can rename, recolour, add or delete them.
 */
export const STARTER_GENRES: readonly { name: string; color: GenreColor }[] = [
  { name: "Historical Fiction", color: "green" },
  { name: "Realistic Fiction", color: "green" },
  { name: "Graphic Novels", color: "blue" },
  { name: "Fantasy", color: "orange" },
  { name: "Science Fiction", color: "orange" },
  { name: "Mystery", color: "red" },
  { name: "Horror", color: "red" },
  { name: "Poetry/Inspirational", color: "pink" },
  { name: "Nonfiction", color: "yellow" },
];

export const MAX_GENRES = 40;

/**
 * Gives a teacher the starter genres, once. A flag in their settings records that it happened,
 * so a teacher who deletes every genre isn't handed them back. Two requests at once can both get
 * here; the unique name index makes the second one a no-op.
 */
async function seedStarterGenres(db: Database, teacherId: string): Promise<void> {
  const [settings] = await db
    .select({ seeded: teacherSettings.genresSeeded })
    .from(teacherSettings)
    .where(eq(teacherSettings.teacherId, teacherId))
    .limit(1);
  if (settings?.seeded) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(genres)
      .values(STARTER_GENRES.map((genre, position) => ({ teacherId, ...genre, position })))
      .onConflictDoNothing();
    await tx
      .insert(teacherSettings)
      .values({ teacherId, genresSeeded: true })
      .onConflictDoUpdate({ target: teacherSettings.teacherId, set: { genresSeeded: true, updatedAt: new Date() } });
  });
}

/** A teacher's genres in their chosen order, each with how many titles wear it. */
export async function listGenres(db: Database, teacherId: string): Promise<Genre[]> {
  await seedStarterGenres(db, teacherId);
  const rows = await db
    .select({
      id: genres.id,
      name: genres.name,
      color: genres.color,
      position: genres.position,
      bookCount: count(books.id),
    })
    .from(genres)
    .leftJoin(books, and(eq(books.genreId, genres.id), eq(books.teacherId, teacherId)))
    .where(eq(genres.teacherId, teacherId))
    .groupBy(genres.id)
    .orderBy(asc(genres.position), asc(genres.name));
  return rows;
}

function cleanName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new ConflictError("Give the genre a name.");
  return cleaned.slice(0, 60);
}

async function requireGenre(db: Database, teacherId: string, genreId: string) {
  const [genre] = await db
    .select({ id: genres.id, position: genres.position })
    .from(genres)
    .where(and(eq(genres.id, genreId), eq(genres.teacherId, teacherId)))
    .limit(1);
  if (!genre) throw new NotFoundError("That genre doesn't exist.");
  return genre;
}

const taken = (name: string) => new ConflictError(`You already have a genre called ${name}.`);

export async function createGenre(db: Database, teacherId: string, input: { name: string; color: GenreColor }): Promise<{ id: string }> {
  const name = cleanName(input.name);
  await seedStarterGenres(db, teacherId);
  const [{ total, last }] = await db
    .select({ total: count(), last: max(genres.position) })
    .from(genres)
    .where(eq(genres.teacherId, teacherId));
  if (total >= MAX_GENRES) throw new ConflictError(`A library can have up to ${MAX_GENRES} genres.`);
  try {
    const [created] = await db
      .insert(genres)
      .values({ teacherId, name, color: input.color, position: (last ?? -1) + 1 })
      .returning({ id: genres.id });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw taken(name);
    throw error;
  }
}

export async function updateGenre(
  db: Database,
  teacherId: string,
  genreId: string,
  input: { name?: string; color?: GenreColor },
): Promise<void> {
  await requireGenre(db, teacherId, genreId);
  const patch: { name?: string; color?: GenreColor } = {};
  if (input.name !== undefined) patch.name = cleanName(input.name);
  if (input.color !== undefined) patch.color = input.color;
  if (!patch.name && !patch.color) return;
  try {
    await db.update(genres).set(patch).where(and(eq(genres.id, genreId), eq(genres.teacherId, teacherId)));
  } catch (error) {
    if (isUniqueViolation(error) && patch.name) throw taken(patch.name);
    throw error;
  }
}

/** Moves a genre one place up or down the list, swapping with its neighbour. */
export async function moveGenre(db: Database, teacherId: string, genreId: string, direction: "up" | "down"): Promise<void> {
  await db.transaction(async (tx) => {
    const list = await tx
      .select({ id: genres.id })
      .from(genres)
      .where(eq(genres.teacherId, teacherId))
      .orderBy(asc(genres.position), asc(genres.name));
    const index = list.findIndex((genre) => genre.id === genreId);
    if (index === -1) throw new NotFoundError("That genre doesn't exist.");
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    // Renumbered whole, so positions stay 0, 1, 2… however they were left before.
    for (const [position, genre] of list.entries()) {
      await tx.update(genres).set({ position }).where(eq(genres.id, genre.id));
    }
  });
}

/** Deletes a genre. Its books keep everything else and simply have no genre. */
export async function deleteGenre(db: Database, teacherId: string, genreId: string): Promise<{ booksCleared: number }> {
  await requireGenre(db, teacherId, genreId);
  const [{ booksCleared }] = await db
    .select({ booksCleared: count() })
    .from(books)
    .where(and(eq(books.genreId, genreId), eq(books.teacherId, teacherId)));
  await db.delete(genres).where(and(eq(genres.id, genreId), eq(genres.teacherId, teacherId)));
  return { booksCleared };
}

/**
 * Makes sure a genre id belongs to the teacher before it's written onto a book. The composite
 * foreign key would reject it anyway; this turns that into a clear message.
 */
export async function assertGenreOwned(db: Database, teacherId: string, genreId: string | null): Promise<void> {
  if (genreId) await requireGenre(db, teacherId, genreId);
}

/**
 * The recipient's genre with the same name (any case), created in the sender's colour if they
 * have none. Used when a hand-over moves books, whose genres are the sender's own.
 */
export async function genreForRecipient(
  db: Database,
  recipientId: string,
  genre: { name: string; color: GenreColor },
): Promise<string> {
  await seedStarterGenres(db, recipientId);
  const theirs = await db.select({ id: genres.id, name: genres.name }).from(genres).where(eq(genres.teacherId, recipientId));
  const existing = theirs.find((candidate) => candidate.name.toLowerCase() === genre.name.toLowerCase());
  if (existing) return existing.id;
  const [{ last }] = await db.select({ last: max(genres.position) }).from(genres).where(eq(genres.teacherId, recipientId));
  const [created] = await db
    .insert(genres)
    .values({ teacherId: recipientId, name: genre.name, color: genre.color, position: (last ?? -1) + 1 })
    .returning({ id: genres.id });
  return created.id;
}
