import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { user } from "@/db/schema";
import { shelfScanConfigured } from "@/server/shelf-scan";
import { authorizePhone } from "../pairing-request";

export const runtime = "nodejs";

/**
 * The phone's first call. Claims the pairing for this device and tells it whose library
 * it is feeding, so nobody scans forty books into the wrong account.
 */
export async function POST(request: Request) {
  const authorized = await authorizePhone(request);
  if ("response" in authorized) return authorized.response;

  const [teacher] = await getDb()
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, authorized.pairing.teacherId));

  return Response.json({
    teacherName: teacher?.name ?? "your library",
    deviceLabel: authorized.pairing.deviceLabel,
    canSendShelfPhotos: shelfScanConfigured(),
  });
}
