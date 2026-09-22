import { getDb } from "@/db/client";
import { isUserFacingError, LimitError } from "@/server/errors";
import { type Pairing, verifyPairing } from "@/server/scan-pairing";

/**
 * The phone carries its credential in headers, never in the URL. The token reaches the
 * phone in the QR code's fragment, which browsers don't send to servers, so it stays out
 * of access logs, referrers and history sync — and putting it in a header here keeps it
 * that way on every call the phone makes afterwards.
 */
export const TOKEN_HEADER = "x-scan-token";
export const DEVICE_HEADER = "x-scan-device";

export type PairedRequest = { pairing: Pairing } | { response: Response };

export async function authorizePhone(request: Request): Promise<PairedRequest> {
  try {
    const pairing = await verifyPairing(getDb(), {
      token: request.headers.get(TOKEN_HEADER) ?? "",
      deviceId: request.headers.get(DEVICE_HEADER) ?? "",
      userAgent: request.headers.get("user-agent"),
    });
    return { pairing };
  } catch (error) {
    return { response: problem(error) };
  }
}

/** Turns a data-layer error into a response the phone can show as-is. */
export function problem(error: unknown): Response {
  if (isUserFacingError(error)) {
    const status = error instanceof LimitError ? 429 : error.name === "NotFoundError" ? 401 : 409;
    return Response.json({ message: error.message }, { status });
  }
  console.error(error);
  return Response.json({ message: "Something went wrong. Try again." }, { status: 500 });
}
