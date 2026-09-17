"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { readingLevelSystems, themeContrasts, themeModes } from "@/db/schema/enums";
import { type ActionResult, fail, ok } from "@/lib/action-result";
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
