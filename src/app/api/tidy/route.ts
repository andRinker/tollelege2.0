import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { progressResponse } from "@/lib/progress-stream";
import { requireTeacher } from "@/server/session";
import { suggestTidyBatch, type TidyBatch, tidyConfigured, type TidyProgress, TidyUnavailableError } from "@/server/tidy";

export const runtime = "nodejs";
// One Gemini request may take up to GEMINI_TIMEOUT_MS (240 s); the catalogues run beside it.
export const maxDuration = 300;

/**
 * One batch of "Tidy my library": suggestions for the next books from `after`, streaming how
 * many books Gemini has answered for (`TidyProgress` lines) and then the batch. Nothing is
 * changed here; the teacher chooses what to apply. Always the teacher's own library.
 */
export async function POST(request: Request) {
  // Before the stream opens, so a signed-out request still gets its redirect.
  const { teacherId } = await requireTeacher();
  const body = (await request.json().catch(() => null)) as { after?: unknown } | null;

  return progressResponse<TidyProgress, ActionResult<TidyBatch>>(async (progress) => {
    if (!tidyConfigured()) return fail("Tidying needs Gemini, which isn't set up here.");
    const cursor = z.uuid().nullable().safeParse(body?.after ?? null);
    if (!cursor.success) return fail("Start again from the beginning.");
    try {
      return ok(await suggestTidyBatch(getDb(), teacherId, { after: cursor.data, onProgress: progress }));
    } catch (error) {
      if (!(error instanceof TidyUnavailableError)) {
        console.error(error);
        return fail("Something went wrong. Try again.");
      }
      console.error(`Tidy: ${error.message}`);
      return fail(
        error.reason === "unreadable"
          ? "Gemini's answer couldn't be read. Try that batch again."
          : "Gemini isn't answering right now. Try again in a few minutes.",
      );
    }
  });
}
