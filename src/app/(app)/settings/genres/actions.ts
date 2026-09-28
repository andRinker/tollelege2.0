"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { genreColors } from "@/db/schema/enums";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { ConflictError, NotFoundError } from "@/server/errors";
import { createGenre, deleteGenre, moveGenre, updateGenre } from "@/server/genres";
import { requireTeacher } from "@/server/session";

// Genres are the owner's own, like the rest of Settings: always the signed-in teacher's account,
// whichever classroom they are working in.

const name = z.string().trim().min(1, "Give the genre a name.").max(60, "Keep the name under 60 characters.");
const color = z.enum(genreColors);
const id = z.uuid();

function handle(error: unknown): ActionResult<never> {
  if (error instanceof ConflictError || error instanceof NotFoundError) return fail(error.message);
  throw error;
}

function done() {
  revalidatePath("/settings/genres");
  revalidatePath("/library", "layout");
}

export async function createGenreAction(input: { name: string; color: string }): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  const parsed = z.object({ name, color }).safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That genre isn't valid.");
  try {
    await createGenre(getDb(), teacherId, parsed.data);
  } catch (error) {
    return handle(error);
  }
  done();
  return ok();
}

export async function updateGenreAction(genreId: string, input: { name?: string; color?: string }): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  const parsed = z.object({ genreId: id, name: name.optional(), color: color.optional() }).safeParse({ genreId, ...input });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That genre isn't valid.");
  try {
    await updateGenre(getDb(), teacherId, parsed.data.genreId, { name: parsed.data.name, color: parsed.data.color });
  } catch (error) {
    return handle(error);
  }
  done();
  return ok();
}

export async function moveGenreAction(genreId: string, direction: "up" | "down"): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  const parsed = z.object({ genreId: id, direction: z.enum(["up", "down"]) }).safeParse({ genreId, direction });
  if (!parsed.success) return fail("That genre isn't valid.");
  try {
    await moveGenre(getDb(), teacherId, parsed.data.genreId, parsed.data.direction);
  } catch (error) {
    return handle(error);
  }
  done();
  return ok();
}

export async function deleteGenreAction(genreId: string): Promise<ActionResult<{ booksCleared: number }>> {
  const { teacherId } = await requireTeacher();
  if (!id.safeParse(genreId).success) return fail("That genre isn't valid.");
  try {
    const result = await deleteGenre(getDb(), teacherId, genreId);
    done();
    return ok(result);
  } catch (error) {
    return handle(error);
  }
}
