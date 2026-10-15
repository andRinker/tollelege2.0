import type { ShelfScanActionResult } from "@/app/(app)/library/actions";
import { getDb } from "@/db/client";
import { isUserFacingError } from "@/server/errors";
import { progressResponse } from "@/lib/progress-stream";
import { listBookIdentities } from "@/server/catalog";
import { requireClassroom } from "@/server/session";
import {
  checkPhoto,
  describeShelfFailure,
  parseShelfCount,
  scanShelf,
  type ShelfScanProgress,
  shelfScanConfigured,
  ShelfScanUnavailableError,
} from "@/server/shelf-scan";

export const runtime = "nodejs";
// Readings share a 130-second budget and matching follows; see READING_BUDGET_MS.
export const maxDuration = 180;

/**
 * Reads a shelf photo and proposes books for it, streaming progress as the reading arrives
 * (`ShelfScanProgress` lines, then the `ShelfScanActionResult`). Adds nothing: everything
 * returned is a suggestion for the teacher to confirm, and confirming goes through
 * `quickAddAction` like any other scan. The photo is never written to disk or the database.
 */
export async function POST(request: Request) {
  // Before the stream opens, so a signed-out request still gets its redirect.
  const { teacherId } = await requireClassroom();
  const form = await request.formData().catch(() => null);

  return progressResponse<ShelfScanProgress, ShelfScanActionResult>(async (progress) => {
    if (!shelfScanConfigured()) return { status: "unconfigured" };
    const photo = checkPhoto(form?.get("photo"));
    if ("error" in photo) return { status: "invalid", message: photo.error };
    try {
      // The teacher's own catalogue goes in, so a second printing of a book they already
      // have offers another copy instead of quietly creating a duplicate title.
      const owned = await listBookIdentities(getDb(), teacherId);
      // The teacher's count of books on the shelf, if they gave one: it checks the photo, and
      // earns a second look when the photo comes up short.
      const expected = parseShelfCount(form?.get("expected"));
      const scan = await scanShelf(
        { data: await photo.data.arrayBuffer(), mimeType: photo.mimeType },
        { owned, expected, onProgress: progress },
      );
      return { status: "scanned", ...scan };
    } catch (error) {
      if (error instanceof ShelfScanUnavailableError) {
        console.warn(`Shelf scan unavailable (${error.reason}): ${error.message}`);
        return { status: "unavailable", message: describeShelfFailure(error.reason) };
      }
      if (isUserFacingError(error)) return { status: "unavailable", message: error.message };
      console.error(error);
      return { status: "unavailable", message: "Something went wrong. Try again." };
    }
  });
}
