import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { bookCoverPhotos, books } from "@/db/schema";
import { coverPhotoUrl, isCoverPhotoUrl } from "@/lib/covers";
import { ConflictError, NotFoundError } from "./errors";
import { imageSize } from "./isbn-lookup/cover";

/** The browser shrinks a photo to about 800 pixels before sending it, so a bigger one is not from the app. */
export const MAX_COVER_PHOTO_BYTES = 600 * 1024;

function decodeJpeg(base64: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_COVER_PHOTO_BYTES) throw new ConflictError("That photo is too large. Try again.");
  const size = imageSize(bytes);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || !size || size.width < 150 || size.height < 150) {
    throw new ConflictError("That doesn't look like a photo of a cover. Try again.");
  }
  return bytes;
}

/**
 * A teacher's photo of a book's cover, in place of whatever the catalogues gave. It is the
 * teacher's own edit, so like any other it is final: Tidy and the catalogues leave the cover alone.
 */
export async function saveCoverPhoto(db: Database, teacherId: string, bookId: string, base64Jpeg: string): Promise<void> {
  const bytes = decodeJpeg(base64Jpeg);
  await db.transaction(async (tx) => {
    const [book] = await tx
      .select({ fieldSources: books.fieldSources })
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)))
      .for("update");
    if (!book) throw new NotFoundError("That book isn't in your library.");
    const now = new Date();
    const image = bytes.toString("base64");
    await tx
      .insert(bookCoverPhotos)
      .values({ bookId, teacherId, image, updatedAt: now })
      .onConflictDoUpdate({ target: bookCoverPhotos.bookId, set: { image, updatedAt: now } });
    await tx
      .update(books)
      .set({ coverUrl: coverPhotoUrl(bookId, now.getTime()), fieldSources: { ...book.fieldSources, coverUrl: "teacher" } })
      .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)));
  });
}

/** Takes a photo away and hands the cover back to the catalogues, which may fill it again. */
export async function removeCoverPhoto(db: Database, teacherId: string, bookId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [book] = await tx
      .select({ coverUrl: books.coverUrl, fieldSources: books.fieldSources })
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)))
      .for("update");
    if (!book) throw new NotFoundError("That book isn't in your library.");
    await tx.delete(bookCoverPhotos).where(and(eq(bookCoverPhotos.bookId, bookId), eq(bookCoverPhotos.teacherId, teacherId)));
    if (!isCoverPhotoUrl(book.coverUrl)) return;
    const fieldSources = { ...book.fieldSources };
    delete fieldSources.coverUrl;
    await tx.update(books).set({ coverUrl: null, fieldSources }).where(and(eq(books.id, bookId), eq(books.teacherId, teacherId)));
  });
}

/**
 * The photo for `/api/covers/<bookId>`. Not filtered by teacher: the id is an unguessable uuid, the
 * image is a picture of a book's cover, and connected teachers browsing a shelf need to see it too.
 */
export async function getCoverPhoto(db: Database, bookId: string): Promise<{ bytes: Buffer; updatedAt: Date } | null> {
  const [photo] = await db
    .select({ image: bookCoverPhotos.image, updatedAt: bookCoverPhotos.updatedAt })
    .from(bookCoverPhotos)
    .where(eq(bookCoverPhotos.bookId, bookId));
  return photo ? { bytes: Buffer.from(photo.image, "base64"), updatedAt: photo.updatedAt } : null;
}
