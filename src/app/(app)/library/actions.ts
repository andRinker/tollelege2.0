"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { copyStatuses, metadataSources } from "@/db/schema/enums";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { normalizeIsbn } from "@/lib/isbn";
import {
  addCopies,
  type BookDetailsInput,
  createBook,
  deleteBook,
  deleteCopy,
  findBookByIsbn,
  quickAddByIsbn,
  type QuickAddResult,
  setCopyStatus,
  undoQuickAdd,
  updateBookDetails,
} from "@/server/catalog";
import { isUserFacingError } from "@/server/errors";
import { type BookMetadata, lookupIsbn } from "@/server/isbn-lookup";
import { requireTeacher } from "@/server/session";

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
  const parsedStatus = z.enum(copyStatuses).safeParse(status);
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
