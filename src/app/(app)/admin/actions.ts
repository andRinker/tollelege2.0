"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { createColleagueAccount, deleteTeacherAccount, requireAdmin, signOutTeacher } from "@/server/admin";
import { isUserFacingError } from "@/server/errors";

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

// Better Auth user IDs are opaque strings, not UUIDs.
const teacherId = z.string().min(1).max(100);

export async function signOutTeacherAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!teacherId.safeParse(id).success) return fail("That account doesn't exist.");
  try {
    await signOutTeacher(getDb(), admin, id);
    revalidatePath("/admin", "layout");
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteTeacherAction(id: string, confirmEmail: string): Promise<ActionResult<{ email: string }>> {
  const admin = await requireAdmin();
  const parsed = z.object({ id: teacherId, confirmEmail: z.string().max(320) }).safeParse({ id, confirmEmail });
  if (!parsed.success) return fail("That account doesn't exist.");
  try {
    const deleted = await deleteTeacherAccount(getDb(), admin, parsed.data.id, parsed.data.confirmEmail);
    revalidatePath("/admin", "layout");
    return ok(deleted);
  } catch (error) {
    return handleError(error);
  }
}

const colleague = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(120),
  email: z.email("Enter their school email address.").max(320),
});

export async function createColleagueAction(name: string, email: string): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  const parsed = colleague.safeParse({ name, email });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the name and email.");
  try {
    const created = await createColleagueAccount(getDb(), admin, parsed.data);
    revalidatePath("/admin", "layout");
    return ok(created);
  } catch (error) {
    return handleError(error);
  }
}
