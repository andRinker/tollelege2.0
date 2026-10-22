import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { progressResponse } from "@/lib/progress-stream";
import { requireTeacher } from "@/server/session";
import { tidyConfigured, type TidyProgress, TidyUnavailableError } from "@/server/tidy";
import { stepTidyRun, type TidyStep } from "@/server/tidy-run";

export const runtime = "nodejs";
// One Gemini request may take up to GEMINI_TIMEOUT_MS (240 s); the catalogues run beside it.
export const maxDuration = 300;

/**
 * The next batch of the teacher's "Tidy my library" run, streaming how many books Gemini has
 * answered for (`TidyProgress` lines) and then the run as it stands. The browser calls this
 * again and again until the run is finished. Nothing in the library is changed here; the
 * teacher chooses what to apply at the end. Always the teacher's own library.
 */
export async function POST() {
  // Before the stream opens, so a signed-out request still gets its redirect.
  const { teacherId } = await requireTeacher();

  return progressResponse<TidyProgress, ActionResult<TidyStep>>(async (progress) => {
    if (!tidyConfigured()) return fail("Tidying needs Gemini, which isn't set up here.");
    try {
      return ok(await stepTidyRun(getDb(), teacherId, { onProgress: progress }));
    } catch (error) {
      if (!(error instanceof TidyUnavailableError)) {
        console.error(error);
        return fail("Something went wrong while checking some books.");
      }
      console.error(`Tidy: ${error.message}`);
      return fail(
        error.reason === "unreadable"
          ? "Gemini's answer for some books couldn't be read."
          : "Gemini isn't answering right now.",
      );
    }
  });
}
