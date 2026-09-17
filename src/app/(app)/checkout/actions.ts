"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { todayInTimeZone } from "@/lib/dates";
import { normalizeIsbn } from "@/lib/isbn";
import { findBookByIsbn } from "@/server/catalog";
import {
  checkInLoan,
  checkOutBook,
  type CheckoutResult,
  findBooksToCheckOut,
  listOpenLoans,
  markLoanLost,
  type ReturnResult,
  undoCheckIn,
  undoCheckOut,
} from "@/server/circulation";
import { isUserFacingError } from "@/server/errors";
import { requireTeacher } from "@/server/session";
import { getTeacherSettings } from "@/server/settings";

const id = z.uuid();

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

function revalidateCirculation() {
  // Availability and counts show up on nearly every page.
  revalidatePath("/", "layout");
}

async function validDueOn(teacherId: string, dueOn: string | null): Promise<string | null | { error: string }> {
  if (dueOn === null) return null;
  if (!z.iso.date().safeParse(dueOn).success) return { error: "Choose a valid due date." };
  const settings = await getTeacherSettings(getDb(), teacherId);
  if (dueOn < todayInTimeZone(settings.timeZone)) return { error: "Choose a due date that isn't in the past." };
  return dueOn;
}

export async function checkOutAction(input: { studentId: string; bookId: string; dueOn: string | null }): Promise<ActionResult<CheckoutResult>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(input.studentId).success || !id.safeParse(input.bookId).success) return fail("That book or student wasn't found.");
  const dueOn = await validDueOn(teacherId, input.dueOn);
  if (dueOn && typeof dueOn === "object") return fail(dueOn.error);
  try {
    const result = await checkOutBook(getDb(), teacherId, { studentId: input.studentId, bookId: input.bookId, dueOn });
    revalidateCirculation();
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

export type IsbnCheckoutResult =
  | { status: "checked_out"; result: CheckoutResult }
  | { status: "invalid" }
  | { status: "not_in_library"; isbn13: string }
  | { status: "error"; message: string };

export async function checkOutByIsbnAction(input: { studentId: string; isbn: string; dueOn: string | null }): Promise<IsbnCheckoutResult> {
  const { teacherId } = await requireTeacher();
  const isbn13 = normalizeIsbn(String(input.isbn));
  if (!isbn13) return { status: "invalid" };
  const book = await findBookByIsbn(getDb(), teacherId, isbn13);
  if (!book) return { status: "not_in_library", isbn13 };
  const result = await checkOutAction({ studentId: input.studentId, bookId: book.id, dueOn: input.dueOn });
  return result.ok ? { status: "checked_out", result: result.data } : { status: "error", message: result.message };
}

export async function searchBooksToCheckOutAction(query: string) {
  const { teacherId } = await requireTeacher();
  const trimmed = String(query).trim().slice(0, 100);
  if (trimmed.length < 2) return [];
  return findBooksToCheckOut(getDb(), teacherId, trimmed);
}

export async function undoCheckOutAction(loanId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(loanId).success) return fail("That checkout wasn't found.");
  try {
    await undoCheckOut(getDb(), teacherId, loanId);
    revalidateCirculation();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function checkInAction(loanId: string): Promise<ActionResult<ReturnResult>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(loanId).success) return fail("That checkout wasn't found.");
  try {
    const result = await checkInLoan(getDb(), teacherId, loanId);
    revalidateCirculation();
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

export type IsbnCheckInResult =
  | { status: "returned"; result: ReturnResult }
  | { status: "choose"; title: string; loans: Array<{ loanId: string; studentName: string; className: string | null; copyNumber: number; dueOn: string | null; overdue: boolean }> }
  | { status: "none_out"; title: string; bookId: string }
  | { status: "not_in_library"; isbn13: string }
  | { status: "invalid" }
  | { status: "error"; message: string };

/** Scanning a returned book: checks it in right away when only one copy is out. */
export async function checkInByIsbnAction(isbn: string): Promise<IsbnCheckInResult> {
  const { teacherId } = await requireTeacher();
  const isbn13 = normalizeIsbn(String(isbn));
  if (!isbn13) return { status: "invalid" };
  const db = getDb();
  const book = await findBookByIsbn(db, teacherId, isbn13);
  if (!book) return { status: "not_in_library", isbn13 };

  const settings = await getTeacherSettings(db, teacherId);
  const open = await listOpenLoans(db, teacherId, { today: todayInTimeZone(settings.timeZone), bookId: book.id });
  if (open.length === 0) return { status: "none_out", title: book.title, bookId: book.id };
  if (open.length > 1) {
    return {
      status: "choose",
      title: book.title,
      loans: open.map((loan) => ({
        loanId: loan.loanId,
        studentName: loan.studentName,
        className: loan.className,
        copyNumber: loan.copyNumber,
        dueOn: loan.dueOn,
        overdue: loan.overdue,
      })),
    };
  }
  const result = await checkInAction(open[0].loanId);
  return result.ok ? { status: "returned", result: result.data } : { status: "error", message: result.message };
}

export async function undoCheckInAction(loanId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(loanId).success) return fail("That checkout wasn't found.");
  try {
    await undoCheckIn(getDb(), teacherId, loanId);
    revalidateCirculation();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function markLostAction(loanId: string): Promise<ActionResult<ReturnResult>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(loanId).success) return fail("That checkout wasn't found.");
  try {
    const result = await markLoanLost(getDb(), teacherId, loanId);
    revalidateCirculation();
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}
