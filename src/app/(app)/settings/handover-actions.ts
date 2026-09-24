"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { isUserFacingError } from "@/server/errors";
import {
  type AcceptOutcome,
  acceptHandover,
  declineHandover,
  offerHandover,
  type OfferOutcome,
  withdrawHandover,
} from "@/server/handover";
import { CLASSROOM_COOKIE, requireTeacher } from "@/server/session";

// Hand-overs are between accounts, not classrooms: they always act on the signed-in
// teacher's own library, whichever classroom they happen to be working in.

const id = z.uuid();

const offerInput = z.object({
  email: z.email("Enter their school email address.").max(320),
  classIds: z.array(z.uuid()).max(200),
  /** The whole library, resolved again when it's accepted; `classIds` and `books` are then ignored. */
  everything: z.boolean().optional(),
  books: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("tag"), tag: z.string().trim().min(1, "Choose a tag.").max(40) }),
    z.object({ kind: z.literal("location"), location: z.string().trim().min(1, "Choose a bin or shelf.").max(60) }),
    z.object({
      kind: z.literal("picked"),
      books: z
        .array(z.object({ bookId: z.uuid(), copies: z.number().int().min(1).max(1000).nullable() }))
        .min(1, "Choose at least one book.")
        .max(5000),
    }),
  ]),
});

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

export async function offerHandoverAction(input: z.input<typeof offerInput>): Promise<ActionResult<OfferOutcome>> {
  const { teacherId } = await requireTeacher();
  const parsed = offerInput.safeParse({ ...input, email: String(input?.email ?? "").trim() });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check what you've chosen.");
  try {
    const outcome = await offerHandover(getDb(), teacherId, parsed.data);
    revalidatePath("/settings", "layout");
    return ok(outcome);
  } catch (error) {
    return handleError(error);
  }
}

export async function withdrawHandoverAction(handoverId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(handoverId).success) return fail("That hand-over wasn't found.");
  try {
    await withdrawHandover(getDb(), teacherId, handoverId);
    revalidatePath("/settings", "layout");
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function declineHandoverAction(handoverId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(handoverId).success) return fail("That hand-over wasn't found.");
  try {
    await declineHandover(getDb(), teacherId, handoverId);
    revalidatePath("/dashboard");
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function acceptHandoverAction(handoverId: string): Promise<ActionResult<AcceptOutcome>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(handoverId).success) return fail("That hand-over wasn't found.");
  try {
    const outcome = await acceptHandover(getDb(), teacherId, handoverId);
    if (outcome.status === "accepted") {
      // What arrived is in their own classroom, so that's where they land.
      (await cookies()).delete(CLASSROOM_COOKIE);
      revalidatePath("/", "layout");
    }
    return ok(outcome);
  } catch (error) {
    return handleError(error);
  }
}
