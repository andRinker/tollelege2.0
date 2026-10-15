"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { readingLevelSystems, themeContrasts, themeModes } from "@/db/schema/enums";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { FIND_SERIES_BATCH, findSeriesBatch, type FindSeriesResult } from "@/server/find-series";
import { applyTidy, suggestTidyBatch, TIDY_BATCH, type TidyBatch, tidyConfigured, TidyUnavailableError } from "@/server/tidy";
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

/**
 * One batch of "Tidy my library": suggestions for the next books from `after`. Nothing is
 * changed here; the teacher chooses what to apply.
 */
export async function suggestTidyAction(after: string | null): Promise<ActionResult<TidyBatch>> {
  const { teacherId } = await requireTeacher();
  if (!tidyConfigured()) return fail("Tidying needs Gemini, which isn't set up here.");
  const cursor = z.uuid().nullable().safeParse(after);
  if (!cursor.success) return fail("Start again from the beginning.");
  try {
    return ok(await suggestTidyBatch(getDb(), teacherId, { after: cursor.data }));
  } catch (error) {
    if (!(error instanceof TidyUnavailableError)) throw error;
    console.error(`Tidy: ${error.message}`);
    return fail(
      error.reason === "unreadable"
        ? "Gemini's answer couldn't be read. Try that batch again."
        : "Gemini isn't answering right now. Try again in a few minutes.",
    );
  }
}

const text = (max: number) => z.string().trim().min(1).max(max);
const tidyPatch = z
  .object({
    title: text(500),
    authors: z.array(text(200)).min(1).max(10),
    series: z.object({ name: text(120), number: z.number().min(0).max(9999).nullable() }).strict(),
    subtitle: text(500),
    description: text(5000),
    coverUrl: text(1000),
    publisher: text(300),
    publishedYear: z.number().int().min(1000).max(2999),
    pageCount: z.number().int().min(1).max(99_999),
  })
  .partial()
  .strict();
const tidyChanges = z.array(z.object({ bookId: z.uuid(), patch: tidyPatch }).strict()).max(TIDY_BATCH);

/** Applies the tidy changes a teacher ticked. Each is checked again against the book as it is now. */
export async function applyTidyAction(changes: unknown): Promise<ActionResult<{ changed: number }>> {
  const { teacherId } = await requireTeacher();
  const parsed = tidyChanges.safeParse(changes);
  if (!parsed.success) return fail("Those changes couldn't be applied. Look at the batch again.");
  const changed = await applyTidy(getDb(), teacherId, parsed.data);
  if (changed > 0) revalidatePath("/library");
  return ok({ changed });
}
