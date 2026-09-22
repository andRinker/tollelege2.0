import { z } from "zod";
import { getDb } from "@/db/client";
import { addBookByScan } from "@/server/quick-add";
import { assertWithinLimits, recordScanEvent } from "@/server/scan-pairing";
import { authorizePhone, problem } from "../pairing-request";

export const runtime = "nodejs";

const body = z.object({ isbn13: z.string().min(1).max(32) });

/**
 * A barcode read on the phone. The phone's request is what performs the add, so the
 * signed-in browser can be asleep in another room and lose nothing — it reads the
 * backlog when it wakes.
 */
export async function POST(request: Request) {
  const authorized = await authorizePhone(request);
  if ("response" in authorized) return authorized.response;
  const { pairing } = authorized;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "Send an ISBN." }, { status: 400 });

  try {
    await assertWithinLimits(getDb(), pairing.pairingId, "isbn");
    const outcome = await addBookByScan(getDb(), pairing.teacherId, parsed.data.isbn13);

    if (outcome.status === "invalid") {
      return Response.json({ status: "invalid", message: "That isn't a valid ISBN." }, { status: 400 });
    }
    if (outcome.status === "added") {
      await recordScanEvent(getDb(), pairing, "book_added", outcome);
      return Response.json(outcome);
    }
    await recordScanEvent(getDb(), pairing, "lookup_failed", outcome);
    return Response.json(outcome);
  } catch (error) {
    return problem(error);
  }
}
