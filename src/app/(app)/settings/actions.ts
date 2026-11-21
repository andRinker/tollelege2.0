"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { readingLevelSystems, themeContrasts, themeModes } from "@/db/schema/enums";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { FIND_SERIES_BATCH, findSeriesBatch, type FindSeriesResult } from "@/server/find-series";
import type { TidySuggestion } from "@/lib/tidy";
import { tidyConfigured } from "@/server/tidy";
import {
  applyTidyRun,
  discardTidyRun,
  getTidyRunStatus,
  startTidyRun,
  tidyRunSuggestions,
  type TidyRunStatus,
} from "@/server/tidy-run";
import { reconcileLibrary, undoReconcile } from "@/server/reconcile";
import { requireTeacher } from "@/server/session";
import { isValidTimeZone, updateTeacherSettings } from "@/server/settings";

const settingsPatch = z
  .object({
    loanPeriodDays: z.number().int().min(1).max(365).nullable(),
    maxBooksPerStudent: z.number().int().min(1).max(50).nullable(),
    readingLevelSystem: z.enum(readingLevelSystems),
    timeZone: z.string().refine(isValidTimeZone, "Choose a time zone from the list."),
    themeSeedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    themeMode: z.enum(themeModes),
    themeContrast: z.enum(themeContrasts),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatch>;

export async function saveSettings(patch: SettingsPatch): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  const parsed = settingsPatch.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That setting isn't valid.");

  await updateTeacherSettings(getDb(), teacherId, parsed.data);
  revalidatePath("/", "layout");
  return ok();
}

/**
 * One batch of "Find series for my library": the next books from `after`, or with `retry`, the
 * books an earlier batch left unanswered. Always the teacher's own library, like Settings.
 */
export async function findSeriesAction(
  after: string | null,
  retry?: string[],
): Promise<ActionResult<FindSeriesResult>> {
  const { teacherId } = await requireTeacher();
  const cursor = z.uuid().nullable().safeParse(after);
  const ids = z.array(z.uuid()).max(FIND_SERIES_BATCH).optional().safeParse(retry);
  if (!cursor.success || !ids.success) return fail("Start again from the beginning.");
  const result = await findSeriesBatch(getDb(), teacherId, { after: cursor.data, ids: ids.data });
  if (result.checked > 0 && result.unansweredIds.length === result.checked) {
    return fail("Open Library isn't answering right now. Try again in a few minutes.");
  }
  if (result.found > 0) revalidatePath("/library");
  return ok(result);
}

const bookIds = z.array(z.uuid()).max(5000);

/**
 * Starts "Tidy my library" from the first book; the app frame then keeps it going. With
 * `fixEverything`, spellings are settled first and what Gemini is sure of is applied as the run
 * goes, all under one batch the teacher can undo; only the doubtful wait for review.
 */
export async function startTidyAction(fixEverything: unknown = false): Promise<ActionResult<TidyRunStatus>> {
  const { teacherId } = await requireTeacher();
  const parsed = z.boolean().safeParse(fixEverything);
  if (!parsed.success) return fail("That couldn't be started.");
  if (!tidyConfigured()) return fail("Tidying needs Gemini, which isn't set up here.");
  const db = getDb();
  if (!parsed.data) return ok(await startTidyRun(db, teacherId));
  const batchId = crypto.randomUUID();
  await reconcileLibrary(db, teacherId, batchId);
  const status = await startTidyRun(db, teacherId, { confident: true, batchId });
  revalidatePath("/library");
  return ok(status);
}

/** Where the teacher's run has got to, or null when there is none. */
export async function tidyRunStatusAction(): Promise<ActionResult<TidyRunStatus | null>> {
  const { teacherId } = await requireTeacher();
  return ok(await getTidyRunStatus(getDb(), teacherId));
}

/** Everything a finished run found, for the review. */
export async function tidyReviewAction(): Promise<ActionResult<TidySuggestion[]>> {
  const { teacherId } = await requireTeacher();
  return ok(await tidyRunSuggestions(getDb(), teacherId));
}

/**
 * Applies the suggestions ticked, named by book: the changes themselves are the run's own,
 * kept on the server, and each is checked again against the book as it is now.
 */
export async function applyTidyAction(ids: unknown): Promise<ActionResult<{ changed: number }>> {
  const { teacherId } = await requireTeacher();
  const parsed = bookIds.safeParse(ids);
  if (!parsed.success) return fail("Those changes couldn't be applied.");
  const changed = await applyTidyRun(getDb(), teacherId, parsed.data);
  if (changed > 0) revalidatePath("/library");
  return ok({ changed });
}

/** Ends the run without applying anything. */
export async function discardTidyAction(): Promise<ActionResult<null>> {
  const { teacherId } = await requireTeacher();
  await discardTidyRun(getDb(), teacherId);
  return ok(null);
}

/** Gives every series and author one spelling across the library, logged so it can be undone. */
export async function settleSpellingsAction(): Promise<ActionResult<{ batchId: string | null; changed: number }>> {
  const { teacherId } = await requireTeacher();
  const done = await reconcileLibrary(getDb(), teacherId);
  if (done) {
    revalidatePath("/library");
    revalidatePath("/settings");
  }
  return ok({ batchId: done?.batchId ?? null, changed: done?.changed ?? 0 });
}

/** Puts back everything one settling pass changed, except books edited since. */
export async function undoSettleAction(batchId: unknown): Promise<ActionResult<{ restored: number; kept: number }>> {
  const { teacherId } = await requireTeacher();
  const parsed = z.string().uuid().safeParse(batchId);
  if (!parsed.success) return fail("That change can't be undone.");
  const result = await undoReconcile(getDb(), teacherId, parsed.data);
  revalidatePath("/library");
  revalidatePath("/settings");
  return ok(result);
}
