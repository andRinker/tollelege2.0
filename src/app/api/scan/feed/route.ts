import { getDb } from "@/db/client";
import { listScanEvents } from "@/server/scan-pairing";
import { getSession } from "@/server/session";

export const runtime = "nodejs";

/**
 * The signed-in browser catching up on what the phone did. This one is the teacher's own
 * session, not a pairing token — a phone can write to the feed but can never read it.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ message: "Sign in again." }, { status: 401 });

  const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
  const events = await listScanEvents(getDb(), session.user.id, Number.isFinite(since) ? since : 0);
  return Response.json(
    { events, cursor: events.at(-1)?.seq ?? since },
    { headers: { "cache-control": "no-store" } },
  );
}
