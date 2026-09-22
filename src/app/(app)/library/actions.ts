"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { manualCopyStatuses, metadataSources } from "@/db/schema/enums";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { normalizeIsbn } from "@/lib/isbn";
import {
  addCopies,
  type BookDetailsInput,
  createBook,
  deleteBook,
  deleteCopy,
  findBookByIsbn,
  listBookIdentities,
  quickAddByIsbn,
  type QuickAddResult,
  setBookLendable,
  setCopyStatus,
  undoQuickAdd,
  updateBookDetails,
} from "@/server/catalog";
import { isUserFacingError } from "@/server/errors";
import { type BookMetadata, lookupIsbn } from "@/server/isbn-lookup";
import { requireTeacher } from "@/server/session";
import {
  scanShelf,
  shelfScanConfigured,
  type ShelfProposal,
  ShelfScanUnavailableError,
} from "@/server/shelf-scan";

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

function revalidateLibrary(bookId?: string) {
  revalidatePath("/library");
  revalidatePath("/dashboard");
  if (bookId) revalidatePath(`/library/${bookId}`);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

const bookDetails = z.object({
  isbn13: z
    .string()
    .nullable()
    .transform((value, context) => {
      if (!value?.trim()) return null;
      const isbn = normalizeIsbn(value);
      if (!isbn) context.addIssue({ code: "custom", message: "That ISBN isn't valid.", path: ["isbn13"] });
      return isbn;
    }),
  title: z.string().trim().min(1, "Enter a title.").max(300),
  subtitle: optionalText(300),
  authors: z.array(z.string().trim().min(1).max(120)).max(10),
  description: optionalText(5000),
  coverUrl: z
    .string()
    .url()
    .startsWith("https://")
    .max(500)
    .nullable(),
  publisher: optionalText(200),
  publishedYear: z.number().int().min(1400).max(2100).nullable(),
  pageCount: z.number().int().min(1).max(10000).nullable(),
  readingLevel: optionalText(20),
  tags: z.array(z.string().max(40)).max(30),
  location: optionalText(60),
  notes: optionalText(2000),
  metadataSource: z.enum(metadataSources),
});

const id = z.uuid();

export type LookupActionResult =
  | { status: "invalid" }
  | { status: "owned"; isbn13: string; book: { id: string; title: string; authors: string[]; coverUrl: string | null; totalCopies: number } }
  | { status: "found"; isbn13: string; metadata: BookMetadata }
  | { status: "not_found"; isbn13: string }
  | { status: "unavailable"; isbn13: string };

export async function lookupIsbnAction(raw: string): Promise<LookupActionResult> {
  const { teacherId } = await requireTeacher();
  const isbn13 = normalizeIsbn(String(raw));
  if (!isbn13) return { status: "invalid" };

  const db = getDb();
  const owned = await findBookByIsbn(db, teacherId, isbn13);
  if (owned) return { status: "owned", isbn13, book: owned };

  const result = await lookupIsbn(db, isbn13);
  if (result.status === "found") return { status: "found", isbn13, metadata: result.metadata };
  return { status: result.status, isbn13 };
}

export async function addBookAction(input: BookDetailsInput, copyCount: number): Promise<ActionResult<{ bookId: string }>> {
  const { teacherId } = await requireTeacher();
  const parsed = bookDetails.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the book details.");
  const copiesToAdd = z.number().int().min(1).max(100).safeParse(copyCount);
  if (!copiesToAdd.success) return fail("Choose between 1 and 100 copies.");

  try {
    const { bookId } = await createBook(getDb(), teacherId, parsed.data, copiesToAdd.data);
    revalidateLibrary();
    return ok({ bookId });
  } catch (error) {
    return handleError(error);
  }
}

export type QuickAddActionResult =
  | { status: "added"; isbn13: string; result: QuickAddResult }
  | { status: "invalid" }
  | { status: "not_found"; isbn13: string }
  | { status: "unavailable"; isbn13: string }
  | { status: "error"; isbn13: string; message: string };

export async function quickAddAction(raw: string): Promise<QuickAddActionResult> {
  const { teacherId } = await requireTeacher();
  const isbn13 = normalizeIsbn(String(raw));
  if (!isbn13) return { status: "invalid" };

  const db = getDb();
  try {
    const owned = await findBookByIsbn(db, teacherId, isbn13);
    let result: QuickAddResult;
    if (owned) {
      const { copyIds, totalCopies } = await addCopies(db, teacherId, owned.id);
      result = { outcome: "copy_added", bookId: owned.id, copyId: copyIds[0], title: owned.title, authors: owned.authors, coverUrl: owned.coverUrl, totalCopies };
    } else {
      const lookup = await lookupIsbn(db, isbn13);
      if (lookup.status !== "found") return { status: lookup.status, isbn13 };
      result = await quickAddByIsbn(db, teacherId, isbn13, lookup.metadata);
    }
    revalidateLibrary();
    return { status: "added", isbn13, result };
  } catch (error) {
    return { status: "error", isbn13, message: handleError(error).message };
  }
}

export async function undoQuickAddAction(copyId: string): Promise<ActionResult<{ outcome: "copy_removed" | "book_removed" }>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(copyId).success) return fail("That copy wasn't found.");
  try {
    const outcome = await undoQuickAdd(getDb(), teacherId, copyId);
    revalidateLibrary();
    return ok({ outcome });
  } catch (error) {
    return handleError(error);
  }
}

export async function updateBookAction(bookId: string, input: BookDetailsInput): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  const parsed = bookDetails.safeParse(input);
  if (!id.safeParse(bookId).success || !parsed.success) {
    return fail(parsed.error?.issues[0]?.message ?? "Check the book details.");
  }
  try {
    await updateBookDetails(getDb(), teacherId, bookId, parsed.data);
    revalidateLibrary(bookId);
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteBookAction(bookId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(bookId).success) return fail("That book wasn't found.");
  try {
    await deleteBook(getDb(), teacherId, bookId);
    revalidateLibrary();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function setBookLendableAction(bookId: string, lendable: boolean): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(bookId).success) return fail("That book wasn't found.");
  try {
    await setBookLendable(getDb(), teacherId, bookId, Boolean(lendable));
    revalidateLibrary(bookId);
    revalidatePath("/lending", "layout");
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function addCopyAction(bookId: string): Promise<ActionResult<{ totalCopies: number }>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(bookId).success) return fail("That book wasn't found.");
  try {
    const { totalCopies } = await addCopies(getDb(), teacherId, bookId);
    revalidateLibrary(bookId);
    return ok({ totalCopies });
  } catch (error) {
    return handleError(error);
  }
}

export async function setCopyStatusAction(bookId: string, copyId: string, status: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  const parsedStatus = z.enum(manualCopyStatuses).safeParse(status);
  if (!id.safeParse(copyId).success || !parsedStatus.success) return fail("That copy wasn't found.");
  try {
    await setCopyStatus(getDb(), teacherId, copyId, parsedStatus.data);
    revalidateLibrary(bookId);
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteCopyAction(bookId: string, copyId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(copyId).success) return fail("That copy wasn't found.");
  try {
    await deleteCopy(getDb(), teacherId, copyId);
    revalidateLibrary(bookId);
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ShelfScanActionResult =
  | { status: "scanned"; proposals: ShelfProposal[]; unmatched: number }
  | { status: "unconfigured" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

/**
 * Reads a shelf photo and proposes books for it. Adds nothing: everything returned is a
 * suggestion for the teacher to confirm, and confirming goes through `quickAddAction`
 * like any other scan. The photo is never written to disk or to the database.
 */
export async function scanShelfAction(formData: FormData): Promise<ShelfScanActionResult> {
  const { teacherId } = await requireTeacher();
  if (!shelfScanConfigured()) return { status: "unconfigured" };

  const photo = formData.get("photo");
  if (!(photo instanceof File)) return { status: "invalid", message: "Choose a photo of a shelf." };
  if (photo.size === 0) return { status: "invalid", message: "That photo was empty." };
  if (photo.size > MAX_PHOTO_BYTES) {
    return { status: "invalid", message: "That photo is too large. Try again with a single shelf." };
  }
  const mimeType = PHOTO_TYPES.find((type) => type === photo.type);
  if (!mimeType) return { status: "invalid", message: "Photos need to be JPEG, PNG or WebP." };

  try {
    // The teacher's own catalogue goes in, so a second printing of a book they already
    // have offers another copy instead of quietly creating a duplicate title.
    const owned = await listBookIdentities(getDb(), teacherId);
    const scan = await scanShelf({ data: await photo.arrayBuffer(), mimeType }, { owned });
    return { status: "scanned", proposals: scan.proposals, unmatched: scan.unmatched };
  } catch (error) {
    if (error instanceof ShelfScanUnavailableError) {
      console.warn(`Shelf scan unavailable: ${error.message}`);
      return { status: "unavailable", message: "Couldn't read the photo just now. Try again in a moment." };
    }
    return { status: "unavailable", message: handleError(error).message };
  }
}
