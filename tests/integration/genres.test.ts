import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books, genres } from "@/db/schema";
import { type BookDetailsInput, createBook, getBookDetail, listBooks, updateBookDetails } from "@/server/catalog";
import { NotFoundError } from "@/server/errors";
import {
  createGenre,
  deleteGenre,
  listGenres,
  moveGenre,
  STARTER_GENRES,
  updateGenre,
} from "@/server/genres";
import { acceptHandover, offerHandover, pendingHandoversTo } from "@/server/handover";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

function bookInput(overrides: Partial<BookDetailsInput> = {}): BookDetailsInput {
  return {
    isbn13: null,
    title: "Untitled",
    subtitle: null,
    authors: [],
    description: null,
    coverUrl: null,
    publisher: null,
    publishedYear: null,
    pageCount: null,
    readingLevel: null,
    tags: [],
    location: null,
    notes: null,
    metadataSource: "manual",
    ...overrides,
  };
}

describe("genres", () => {
  let testDb: TestDatabase;
  let db: Database;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("starts every teacher with the chart's genres, once", async () => {
    const teacher = await createTeacher(db);
    const first = await listGenres(db, teacher);
    expect(first.map(({ name, color }) => ({ name, color }))).toEqual(STARTER_GENRES);
    expect(first.find((genre) => genre.name === "Nonfiction")?.color).toBe("yellow");

    // Deleting them all doesn't bring them back.
    for (const genre of first) await deleteGenre(db, teacher, genre.id);
    expect(await listGenres(db, teacher)).toEqual([]);
  });

  it("renames, recolours, reorders, and refuses a second genre of the same name", async () => {
    const teacher = await createTeacher(db);
    const [historical, realistic] = await listGenres(db, teacher);
    await updateGenre(db, teacher, historical.id, { name: "History", color: "brown" });
    await moveGenre(db, teacher, realistic.id, "up");
    const after = await listGenres(db, teacher);
    expect(after.slice(0, 2).map(({ name, color }) => [name, color])).toEqual([
      ["Realistic Fiction", "green"],
      ["History", "brown"],
    ]);
    await expect(createGenre(db, teacher, { name: "fantasy", color: "teal" })).rejects.toThrow("already have a genre called");
    const { id } = await createGenre(db, teacher, { name: "Sports", color: "teal" });
    expect((await listGenres(db, teacher)).at(-1)).toMatchObject({ id, name: "Sports", position: STARTER_GENRES.length });
  });

  it("gives a book one of the teacher's own genres, never another teacher's", async () => {
    const ana = await createTeacher(db);
    const ben = await createTeacher(db);
    const [anasFantasy] = (await listGenres(db, ana)).filter((genre) => genre.name === "Fantasy");
    const [bensMystery] = (await listGenres(db, ben)).filter((genre) => genre.name === "Mystery");

    const { bookId } = await createBook(db, ana, bookInput({ title: "The Hobbit", genreId: anasFantasy.id }));
    await expect(createBook(db, ana, bookInput({ title: "Holes", genreId: bensMystery.id }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateBookDetails(db, ana, bookId, { genreId: bensMystery.id })).rejects.toBeInstanceOf(NotFoundError);
    // And the database would refuse it anyway.
    await expect(db.update(books).set({ genreId: bensMystery.id }).where(eq(books.id, bookId))).rejects.toThrow();

    expect((await getBookDetail(db, ana, bookId)).genre).toEqual({ name: "Fantasy", color: "orange" });
    const listed = await listBooks(db, ana, { genre: anasFantasy.id });
    expect(listed.items.map((book) => [book.title, book.genre])).toEqual([["The Hobbit", { name: "Fantasy", color: "orange" }]]);
    expect((await listGenres(db, ana)).find((genre) => genre.id === anasFantasy.id)?.bookCount).toBe(1);
  });

  it("leaves a book with no genre, and nothing else changed, when its genre is deleted", async () => {
    const teacher = await createTeacher(db);
    const horror = (await listGenres(db, teacher)).find((genre) => genre.name === "Horror")!;
    const { bookId } = await createBook(db, teacher, bookInput({ title: "Coraline", genreId: horror.id }));
    await createBook(db, teacher, bookInput({ title: "Wonder" }));

    expect(await deleteGenre(db, teacher, horror.id)).toEqual({ booksCleared: 1 });
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    expect(book).toMatchObject({ title: "Coraline", genreId: null, teacherId: teacher });
    expect((await listBooks(db, teacher, { genre: "none" })).total).toBe(2);
  });

  it("keeps a handed-over book's genre by name, making it for the recipient if they lack it", async () => {
    const maria = await createTeacher(db, "Maria", "maria@genres.test");
    const dan = await createTeacher(db, "Dan", "dan@genres.test");
    const mariasGenres = await listGenres(db, maria);
    const fantasy = mariasGenres.find((genre) => genre.name === "Fantasy")!;
    const { id: survival } = await createGenre(db, maria, { name: "Survival", color: "brown" });
    const hobbit = await createBook(db, maria, bookInput({ title: "The Hobbit", genreId: fantasy.id }));
    const hatchet = await createBook(db, maria, bookInput({ title: "Hatchet", genreId: survival }));

    await offerHandover(db, maria, {
      email: "dan@genres.test",
      classIds: [],
      books: { kind: "picked", books: [{ bookId: hobbit.bookId, copies: null }, { bookId: hatchet.bookId, copies: null }] },
    });
    const [offer] = await pendingHandoversTo(db, dan);
    expect(await acceptHandover(db, dan, offer.id)).toMatchObject({ status: "accepted" });

    const dansGenres = await listGenres(db, dan);
    const moved = await db
      .select({ title: books.title, teacherId: books.teacherId, genre: genres.name, color: genres.color, genreOwner: genres.teacherId })
      .from(books)
      .leftJoin(genres, eq(genres.id, books.genreId))
      .where(eq(books.teacherId, dan));
    expect(moved.sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: "Hatchet", teacherId: dan, genre: "Survival", color: "brown", genreOwner: dan },
      { title: "The Hobbit", teacherId: dan, genre: "Fantasy", color: "orange", genreOwner: dan },
    ]);
    // Dan's own Fantasy was used, not a second one; Survival is new to him.
    expect(dansGenres.filter((genre) => genre.name === "Fantasy")).toHaveLength(1);
    expect(dansGenres.some((genre) => genre.name === "Survival")).toBe(true);
  });
});
