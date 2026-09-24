import type { Metadata } from "next";
import { PhoneScanner } from "./phone-scanner";

export const metadata: Metadata = {
  title: "Scanner",
  // A pairing link is not something to leave lying around in a search index.
  robots: { index: false, follow: false },
};

// Reading a shelf photo takes about 20 seconds, same as anywhere else it happens.
export const maxDuration = 180;

/**
 * The scanner a phone opens after reading the QR code on a teacher's computer.
 *
 * Deliberately outside the signed-in app: there is no session here, no navigation, and
 * nothing to read. It holds a pairing token that can add a book and send a shelf photo,
 * which is the whole reason a teacher whose school account won't sign in on their phone
 * can still stand at a bookcase and catalogue it.
 */
export default function ScanPage() {
  return <PhoneScanner />;
}
