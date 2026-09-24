"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import {
  addCoTeacher,
  type AddCoTeacherOutcome,
  assertOwner,
  cancelCoTeacherInvite,
  leaveClass,
  removeCoTeacher,
  resolveClassroom,
} from "@/server/coteaching";
import { isUserFacingError } from "@/server/errors";
import { CLASSROOM_COOKIE, requireClassroom, requireTeacher } from "@/server/session";

const id = z.uuid();

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

function revalidateClassrooms() {
  // The switcher lives in the layout, so a change in who teaches what reaches every page.
  revalidatePath("/", "layout");
}

export async function addCoTeacherAction(classId: string, email: string): Promise<ActionResult<AddCoTeacherOutcome>> {
  const classroom = await requireClassroom();
  if (!id.safeParse(classId).success) return fail("That class wasn't found.");
  const parsed = z.email("Enter their school email address.").max(320).safeParse(String(email).trim());
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter their school email address.");
  try {
    assertOwner(classroom, "add co-teachers");
    const outcome = await addCoTeacher(getDb(), classroom.teacherId, classId, parsed.data);
    revalidateClassrooms();
    return ok(outcome);
  } catch (error) {
    return handleError(error);
  }
}

export async function removeCoTeacherAction(classId: string, coTeacherId: string): Promise<ActionResult> {
  const classroom = await requireClassroom();
  if (!id.safeParse(classId).success || !z.string().min(1).max(100).safeParse(coTeacherId).success) {
    return fail("That co-teacher wasn't found.");
  }
  try {
    assertOwner(classroom, "remove co-teachers");
    await removeCoTeacher(getDb(), classroom.teacherId, classId, coTeacherId);
    revalidateClassrooms();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function cancelCoTeacherInviteAction(inviteId: string): Promise<ActionResult> {
  const classroom = await requireClassroom();
  if (!id.safeParse(inviteId).success) return fail("That invitation wasn't found.");
  try {
    assertOwner(classroom, "cancel invitations");
    await cancelCoTeacherInvite(getDb(), classroom.teacherId, inviteId);
    revalidateClassrooms();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

/** A co-teacher stepping away from a class shared with them. */
export async function leaveClassAction(classId: string): Promise<ActionResult<{ stillCoTeaching: boolean }>> {
  const teacher = await requireTeacher();
  if (!id.safeParse(classId).success) return fail("That class wasn't found.");
  const classroom = await requireClassroom();
  await leaveClass(getDb(), teacher.teacherId, classId);
  // Stay in their classroom if another class there is still shared; otherwise go home.
  const after = await resolveClassroom(getDb(), teacher, classroom.isOwner ? null : classroom.teacherId);
  if (after.isOwner) (await cookies()).delete(CLASSROOM_COOKIE);
  revalidateClassrooms();
  return ok({ stillCoTeaching: !after.isOwner });
}

/** Switches which classroom this browser works in. Null is your own. */
export async function switchClassroomAction(ownerId: string | null): Promise<ActionResult> {
  const teacher = await requireTeacher();
  const cookieStore = await cookies();
  if (!ownerId || ownerId === teacher.teacherId) {
    cookieStore.delete(CLASSROOM_COOKIE);
  } else {
    const target = await resolveClassroom(getDb(), teacher, z.string().max(100).parse(ownerId));
    if (target.isOwner) return fail("That classroom isn't shared with you any more.");
    cookieStore.set(CLASSROOM_COOKIE, target.teacherId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  }
  revalidateClassrooms();
  return ok();
}
