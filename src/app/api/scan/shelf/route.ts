import { getDb } from "@/db/client";
import { listBookIdentities } from "@/server/catalog";
import { assertWithinLimits, recordScanEvent } from "@/server/scan-pairing";
import { checkPhoto, scanShelf, shelfScanConfigured, ShelfScanUnavailableError } from "@/server/shelf-scan";
import { authorizePhone, problem } from "../pairing-request";

export const runtime = "nodejs";
// Reading a shelf and matching every spine against two catalogues takes about 20 seconds.
export const maxDuration = 60;

/**
 * A shelf photo from the phone. It proposes and never writes: the proposals go to the
 * signed-in browser, where the teacher confirms them exactly as they always have. A
 * phone with no account does not get to add books it merely thinks it recognised.
 *
 * The photo is passed to Google and never stored, here as anywhere else.
 */
export async function POST(request: Request) {
  const authorized = await authorizePhone(request);
  if ("response" in authorized) return authorized.response;
  const { pairing } = authorized;

  if (!shelfScanConfigured()) {
    return Response.json({ message: "Shelf photos aren't set up for this library." }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const photo = checkPhoto(form?.get("photo"));
  if ("error" in photo) return Response.json({ message: photo.error }, { status: 400 });

  try {
    await assertWithinLimits(getDb(), pairing.pairingId, "shelf");
    const owned = await listBookIdentities(getDb(), pairing.teacherId);
    const scan = await scanShelf(
      { data: await photo.data.arrayBuffer(), mimeType: photo.mimeType },
      { owned },
    );
    await recordScanEvent(getDb(), pairing, "shelf_proposed", scan);
    return Response.json({ proposals: scan.proposals.length, unmatched: scan.unmatched });
  } catch (error) {
    if (error instanceof ShelfScanUnavailableError) {
      console.warn(`Shelf scan unavailable: ${error.message}`);
      return Response.json({ message: "Couldn't read that photo. Try again in a moment." }, { status: 503 });
    }
    return problem(error);
  }
}
