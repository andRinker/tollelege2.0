"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import {
  removeConnection,
  requestConnection,
  respondToConnection,
} from "@/server/connections";
import { isUserFacingError } from "@/server/errors";
import {
  approveShelfLoan,
  cancelShelfLoanRequest,
  declineShelfLoan,
  requestShelfLoan,
  returnShelfLoan,
} from "@/server/lending";
import { requireTeacher } from "@/server/session";

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

function revalidateLending() {
  revalidatePath("/lending", "layout");
  revalidatePath("/library");
  revalidatePath("/dashboard");
}

const id = z.uuid();
const teacherId = z.string().min(1).max(100);

export async function inviteTeacherAction(email: string): Promise<ActionResult<{ message: string }>> {
  const { teacherId: me } = await requireTeacher();
  const parsed = z.email().max(200).safeParse(String(email).trim());
  if (!parsed.success) return fail("Enter a valid email address.");

  try {
    const { outcome, name } = await requestConnection(getDb(), me, parsed.data);
    revalidateLending();
    return ok({
      message:
        outcome === "accepted_existing"
          ? `You and ${name} are now sharing shelves.`
          : `Invitation sent to ${name}.`,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function respondToInvitationAction(
  connectionId: string,
  accept: boolean,
): Promise<ActionResult> {
  const { teacherId: me } = await requireTeacher();
  if (!id.safeParse(connectionId).success) return fail("That invitation wasn't found.");
  try {
    await respondToConnection(getDb(), me, connectionId, accept);
    revalidateLending();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function removeConnectionAction(connectionId: string): Promise<ActionResult> {
  const { teacherId: me } = await requireTeacher();
  if (!id.safeParse(connectionId).success) return fail("That connection wasn't found.");
  try {
    await removeConnection(getDb(), me, connectionId);
    revalidateLending();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function requestBookAction(
  ownerTeacherId: string,
  bookId: string,
  message: string,
): Promise<ActionResult<{ title: string }>> {
  const { teacherId: me } = await requireTeacher();
  const parsed = z
    .object({
      ownerTeacherId: teacherId,
      bookId: id,
      message: z.string().trim().max(300).transform((value) => value || null),
    })
    .safeParse({ ownerTeacherId, bookId, message });
  if (!parsed.success) return fail("That book wasn't found.");

  try {
    const { title } = await requestShelfLoan(getDb(), me, parsed.data);
    revalidateLending();
    return ok({ title });
  } catch (error) {
    return handleError(error);
  }
}

export async function approveRequestAction(
  shelfLoanId: string,
  dueOn: string | null,
): Promise<ActionResult<{ message: string }>> {
  const { teacherId: me } = await requireTeacher();
  const parsed = z
    .object({ shelfLoanId: id, dueOn: z.iso.date().nullable() })
    .safeParse({ shelfLoanId, dueOn });
  if (!parsed.success) return fail("That request wasn't found.");

  try {
    const result = await approveShelfLoan(getDb(), me, parsed.data.shelfLoanId, {
      dueOn: parsed.data.dueOn,
    });
    revalidateLending();
    return ok({ message: `${result.title} is on its way to ${result.borrowerName}.` });
  } catch (error) {
    return handleError(error);
  }
}

export async function declineRequestAction(shelfLoanId: string): Promise<ActionResult> {
  const { teacherId: me } = await requireTeacher();
  if (!id.safeParse(shelfLoanId).success) return fail("That request wasn't found.");
  try {
    await declineShelfLoan(getDb(), me, shelfLoanId);
    revalidateLending();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function cancelRequestAction(shelfLoanId: string): Promise<ActionResult> {
  const { teacherId: me } = await requireTeacher();
  if (!id.safeParse(shelfLoanId).success) return fail("That request wasn't found.");
  try {
    await cancelShelfLoanRequest(getDb(), me, shelfLoanId);
    revalidateLending();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function returnLoanAction(shelfLoanId: string): Promise<ActionResult<{ title: string }>> {
  const { teacherId: me } = await requireTeacher();
  if (!id.safeParse(shelfLoanId).success) return fail("That loan wasn't found.");
  try {
    const { title } = await returnShelfLoan(getDb(), me, shelfLoanId);
    revalidateLending();
    return ok({ title });
  } catch (error) {
    return handleError(error);
  }
}
