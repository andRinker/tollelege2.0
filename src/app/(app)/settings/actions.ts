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

/** Starts "Tidy my library" from the first book; the app frame then keeps it going. */
export async function startTidyAction(): Promise<ActionResult<TidyRunStatus>> {
  const { teacherId } = await requireTeacher();
  if (!tidyConfigured()) return fail("Tidying needs Gemini, which isn't set up here.");
  return ok(await startTidyRun(getDb(), teacherId));
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
