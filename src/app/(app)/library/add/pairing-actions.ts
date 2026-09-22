"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { resolveBaseUrl } from "@/lib/auth";
import { isUserFacingError } from "@/server/errors";
import { createPairing, describeExpiry, revokeAllPairings, revokePairing } from "@/server/scan-pairing";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

export type StartedPairing = { pairingId: string; url: string; expiresLabel: string };

/**
 * Hands back a URL whose fragment carries the pairing token. The fragment is the point:
 * browsers never send it to a server, so the token stays out of logs and referrers even
 * though the phone keeps the link in its address bar all day.
 *
 * It is returned exactly once. Only a hash is stored, so this code cannot be shown again
 * later — which is why the UI offers a fresh one rather than pretending to re-open it.
 */
export async function startPairingAction(): Promise<ActionResult<StartedPairing>> {
  const { teacherId } = await requireTeacher();
  try {
    const settings = await getRequestSettings();
    const { pairingId, token, expiresAt } = await createPairing(getDb(), teacherId, settings.timeZone);
    revalidatePath("/library/add");
    return ok({
      pairingId,
      url: `${resolveBaseUrl()}/scan#${token}`,
      expiresLabel: describeExpiry(expiresAt, settings.timeZone),
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Signing out takes your phones with you: nothing paired should outlive the session. */
export async function revokeAllPairingsAction(): Promise<void> {
  const { teacherId } = await requireTeacher();
  try {
    await revokeAllPairings(getDb(), teacherId);
  } catch (error) {
    // Signing out must not fail because of this; the pairing still expires tonight.
    console.error(error);
  }
}

export async function revokePairingAction(pairingId: string): Promise<ActionResult> {
  const { teacherId } = await requireTeacher();
  if (!z.uuid().safeParse(pairingId).success) return fail("That phone wasn't found.");
  try {
    await revokePairing(getDb(), teacherId, pairingId);
    revalidatePath("/library/add");
    return ok();
  } catch (error) {
    return handleError(error);
  }
}
