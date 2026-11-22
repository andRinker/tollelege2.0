import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { bookCoverPhotos, books } from "@/db/schema";
import { isCoverPhotoUrl } from "@/lib/covers";
import { type BookDetailsInput, createBook, listBooks } from "@/server/catalog";
import { getCoverPhoto, removeCoverPhoto, saveCoverPhoto } from "@/server/covers";
import { ConflictError } from "@/server/errors";
import { acceptHandover, offerHandover, pendingHandoversTo } from "@/server/handover";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";
import { jpegOf } from "../helpers/images";

const photo = Buffer.from(jpegOf(400, 600)).toString("base64");

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

describe("a teacher's photo of a cover", () => {
  let testDb: TestDatabase;
  let db: Database;
  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });
  afterAll(async () => {
    await testDb.close();
  });

  it("becomes the cover, is the teacher's own, and can be taken away", async () => {
    const teacher = await createTeacher(db);
    const { bookId } = await createBook(db, teacher, bookInput({ title: "Indie Book" }));
    await saveCoverPhoto(db, teacher, bookId, photo);

    const [saved] = await db.select().from(books).where(eq(books.id, bookId));
    expect(isCoverPhotoUrl(saved.coverUrl)).toBe(true);
    expect(saved.fieldSources.coverUrl).toBe("teacher");
    expect((await getCoverPhoto(db, bookId))?.bytes.length).toBeGreaterThan(0);

    await removeCoverPhoto(db, teacher, bookId);
    const [removed] = await db.select().from(books).where(eq(books.id, bookId));
    expect(removed.coverUrl).toBeNull();
    expect(removed.fieldSources.coverUrl).toBeUndefined();
    expect(await getCoverPhoto(db, bookId)).toBeNull();
  });

  it("refuses what isn't a photo, and another teacher's book", async () => {
    const teacher = await createTeacher(db);
    const other = await createTeacher(db);
    const { bookId } = await createBook(db, teacher, bookInput({ title: "Mine" }));
    await expect(saveCoverPhoto(db, teacher, bookId, Buffer.from("not an image").toString("base64"))).rejects.toBeInstanceOf(ConflictError);
    await expect(saveCoverPhoto(db, other, bookId, photo)).rejects.toThrow();
    expect(await db.select().from(bookCoverPhotos).where(eq(bookCoverPhotos.bookId, bookId))).toHaveLength(0);
  });

  it("is found by the library's no-cover filter only while there's none", async () => {
    const teacher = await createTeacher(db);
    const { bookId } = await createBook(db, teacher, bookInput({ title: "Bare" }));
    expect((await listBooks(db, teacher, { cover: "none" })).items.map((book) => book.title)).toEqual(["Bare"]);
    await saveCoverPhoto(db, teacher, bookId, photo);
    expect((await listBooks(db, teacher, { cover: "none" })).items).toHaveLength(0);
  });

  it("goes with the title when it is handed over", async () => {
    const from = await createTeacher(db);
    const to = await createTeacher(db, "Dan", "photo-dan@covers.test");
    const { bookId } = await createBook(db, from, bookInput({ title: "Handed" }));
    await saveCoverPhoto(db, from, bookId, photo);
    await offerHandover(db, from, { email: "photo-dan@covers.test", classIds: [], books: { kind: "picked", books: [{ bookId, copies: null }] } });
    const [offer] = await pendingHandoversTo(db, to);
    expect(await acceptHandover(db, to, offer.id)).toMatchObject({ status: "accepted" });
    const [moved] = await db.select().from(bookCoverPhotos).where(eq(bookCoverPhotos.bookId, bookId));
    expect(moved.teacherId).toBe(to);
  });
});
