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
  type BulkOutcome,
  bulkDeleteBooks,
  bulkSetLendable,
  bulkUpdateBooks,
  listBookIds,
  MAX_BULK_BOOKS,
  createBook,
  deleteBook,
  deleteCopy,
  findBookByIsbn,
  getBookForEdit,
  listBookIdentities,
  setBookLendable,
  setCopyStatus,
  undoQuickAdd,
  updateBookDetails,
} from "@/server/catalog";
import { isUserFacingError } from "@/server/errors";
import { setAddingGenre } from "@/server/genres";
import { type BookMetadata, lookupIsbn } from "@/server/isbn-lookup";
import { addBookByScan, type QuickAddOutcome } from "@/server/quick-add";
import { assertOwner } from "@/server/coteaching";
import { requireClassroom } from "@/server/session";
import { parseLibraryFilters } from "./filters";
import {
  checkPhoto,
  describeShelfFailure,
  parseShelfCount,
  scanShelf,
  type ShelfScan,
  shelfScanConfigured,
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
  genreId: z.uuid().nullable().optional(),
  series: optionalText(120).optional(),
  seriesNumber: z.number().min(0, "A book number can't be negative.").max(9999).nullable().optional(),
});

const id = z.uuid();

export type LookupActionResult =
  | { status: "invalid" }
  | { status: "owned"; isbn13: string; book: { id: string; title: string; authors: string[]; coverUrl: string | null; totalCopies: number } }
  | { status: "found"; isbn13: string; metadata: BookMetadata }
  | { status: "not_found"; isbn13: string }
  | { status: "unavailable"; isbn13: string };

export async function lookupIsbnAction(raw: string): Promise<LookupActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
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
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
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

export type QuickAddActionResult = QuickAddOutcome | { status: "error"; isbn13: string; message: string };

export async function quickAddAction(raw: string, hints?: { series?: string | null }): Promise<QuickAddActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  const series = z.string().max(200).nullish().safeParse(hints?.series);
  try {
    const outcome = await addBookByScan(getDb(), teacherId, raw, { series: series.success ? series.data : null });
    if (outcome.status === "added") revalidateLibrary();
    return outcome;
  } catch (error) {
    return { status: "error", isbn13: normalizeIsbn(String(raw)) ?? "", message: handleError(error).message };
  }
}

/**
 * Chooses the genre every book added from now on is given. It's the classroom's, like the
 * genres themselves, so a co-teacher cataloguing a shelf sets it for the owner's library.
 */
export async function setAddingGenreAction(genreId: string | null): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const parsed = id.nullable().safeParse(genreId);
  if (!parsed.success) return fail("That genre wasn't found.");
  try {
    await setAddingGenre(getDb(), classroom.teacherId, parsed.data);
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function undoQuickAddAction(copyId: string): Promise<ActionResult<{ outcome: "copy_removed" | "book_removed" }>> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
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
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
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

/** A book's full details, fetched when the library list opens its edit form. */
export async function bookForEditAction(bookId: string): Promise<ActionResult<{ book: Awaited<ReturnType<typeof getBookForEdit>> }>> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(bookId).success) return fail("That book wasn't found.");
  try {
    return ok({ book: await getBookForEdit(getDb(), teacherId, bookId) });
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteBookAction(bookId: string): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(bookId).success) return fail("That book wasn't found.");
  try {
    assertOwner(classroom, "delete books from this library");
    await deleteBook(getDb(), teacherId, bookId);
    revalidateLibrary();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function setBookLendableAction(bookId: string, lendable: boolean): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(bookId).success) return fail("That book wasn't found.");
  try {
    assertOwner(classroom, "change what this library lends");
    await setBookLendable(getDb(), teacherId, bookId, Boolean(lendable));
    revalidateLibrary(bookId);
    revalidatePath("/lending", "layout");
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function addCopyAction(bookId: string): Promise<ActionResult<{ totalCopies: number }>> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
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
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  const parsedStatus = z.enum(manualCopyStatuses).safeParse(status);
  if (!id.safeParse(copyId).success || !parsedStatus.success) return fail("That copy wasn't found.");
  try {
    if (parsedStatus.data === "withdrawn") assertOwner(classroom, "withdraw copies from this library");
    await setCopyStatus(getDb(), teacherId, copyId, parsedStatus.data);
    revalidateLibrary(bookId);
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteCopyAction(bookId: string, copyId: string): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(copyId).success) return fail("That copy wasn't found.");
  try {
    assertOwner(classroom, "delete copies from this library");
    await deleteCopy(getDb(), teacherId, copyId);
    revalidateLibrary(bookId);
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export type ShelfScanActionResult =
  | ({ status: "scanned" } & ShelfScan)
  | { status: "unconfigured" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

/**
 * Reads a shelf photo and proposes books for it. Adds nothing: everything returned is a
 * suggestion for the teacher to confirm, and confirming goes through `quickAddAction`
 * like any other scan. The photo is never written to disk or to the database.
 */
export async function scanShelfAction(formData: FormData): Promise<ShelfScanActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!shelfScanConfigured()) return { status: "unconfigured" };

  const photo = checkPhoto(formData.get("photo"));
  if ("error" in photo) return { status: "invalid", message: photo.error };

  try {
    // The teacher's own catalogue goes in, so a second printing of a book they already
    // have offers another copy instead of quietly creating a duplicate title.
    const owned = await listBookIdentities(getDb(), teacherId);
    // The teacher's count of books on the shelf, if they gave one: it checks the photo, and
    // earns a second look when the photo comes up short.
    const expected = parseShelfCount(formData.get("expected"));
    const scan = await scanShelf({ data: await photo.data.arrayBuffer(), mimeType: photo.mimeType }, { owned, expected });
    return { status: "scanned", ...scan };
  } catch (error) {
    if (error instanceof ShelfScanUnavailableError) {
      console.warn(`Shelf scan unavailable (${error.reason}): ${error.message}`);
      return { status: "unavailable", message: describeShelfFailure(error.reason) };
    }
    return { status: "unavailable", message: handleError(error).message };
  }
}

const bookIds = z.array(z.uuid()).min(1, "Select some books first.").max(MAX_BULK_BOOKS, `Select up to ${MAX_BULK_BOOKS} books at a time.`);

/** Every book the current filters select, for "Select all". Read from the same filters the page uses. */
export async function matchingBookIdsAction(params: Record<string, string>): Promise<ActionResult<{ ids: string[] }>> {
  const { teacherId } = await requireClassroom();
  const parsed = z.record(z.string(), z.string().max(200)).safeParse(params);
  if (!parsed.success) return fail("Those filters aren't valid.");
  // Every page of it, not just the one on screen.
  const filters = { ...parseLibraryFilters(parsed.data), page: undefined };
  return ok({ ids: await listBookIds(getDb(), teacherId, filters) });
}

const bulkPatch = z
  .object({
    genreId: z.uuid().nullable(),
    location: optionalText(60),
    readingLevel: optionalText(20),
  })
  .partial()
  .strict();

/**
 * Sets a genre, bin or reading level on many books at once. A co-teacher may, as they may edit
 * a book; it's the owner's library either way.
 */
export async function bulkEditBooksAction(ids: string[], patch: z.input<typeof bulkPatch>): Promise<ActionResult<{ updated: number }>> {
  const { teacherId } = await requireClassroom();
  const parsedIds = bookIds.safeParse(ids);
  if (!parsedIds.success) return fail(parsedIds.error.issues[0]?.message ?? "Those books weren't found.");
  const parsedPatch = bulkPatch.safeParse(patch);
  if (!parsedPatch.success) return fail(parsedPatch.error.issues[0]?.message ?? "That change isn't valid.");
  try {
    const updated = await bulkUpdateBooks(getDb(), teacherId, parsedIds.data, parsedPatch.data);
    revalidateLibrary();
    return ok({ updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function bulkSetLendableAction(ids: string[], lendable: boolean): Promise<ActionResult<BulkOutcome>> {
  const classroom = await requireClassroom();
  const parsedIds = bookIds.safeParse(ids);
  if (!parsedIds.success) return fail(parsedIds.error.issues[0]?.message ?? "Those books weren't found.");
  try {
    assertOwner(classroom, "change what this library lends");
    const outcome = await bulkSetLendable(getDb(), classroom.teacherId, parsedIds.data, Boolean(lendable));
    revalidateLibrary();
    revalidatePath("/lending", "layout");
    return ok(outcome);
  } catch (error) {
    return handleError(error);
  }
}

export async function bulkDeleteBooksAction(ids: string[]): Promise<ActionResult<BulkOutcome>> {
  const classroom = await requireClassroom();
  const parsedIds = bookIds.safeParse(ids);
  if (!parsedIds.success) return fail(parsedIds.error.issues[0]?.message ?? "Those books weren't found.");
  try {
    assertOwner(classroom, "delete books from this library");
    const outcome = await bulkDeleteBooks(getDb(), classroom.teacherId, parsedIds.data);
    revalidateLibrary();
    return ok(outcome);
  } catch (error) {
    return handleError(error);
  }
}
