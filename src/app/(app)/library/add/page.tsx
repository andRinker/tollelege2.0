import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { catalogSummary } from "@/server/catalog";
import { describeExpiry, latestScanEventSeq, listActivePairings } from "@/server/scan-pairing";
import { requireClassroom } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { PageHeader } from "@/ui/components/expressive";
import { iconArrowBack } from "@/ui/icons/generated";
import { AddBooks } from "./add-books";

export const metadata: Metadata = { title: "Add books" };

// Server actions run inside this page's function, and scanShelfAction reads a photo and
// then searches two catalogues for every spine — around 20 seconds for a full shelf.
// Vercel's default is far higher, but naming it here keeps the feature working if that
// project default is ever lowered, and still caps a runaway scan.
export const maxDuration = 60;

export default async function AddBooksPage() {
  const { teacherId, isOwner } = await requireClassroom();
  const db = getDb();
  // Phone pairing is the owner's: it's revoked when *they* sign out, so a co-teacher's
  // pairing would outlive their session with no one to end it. The feed that follows it
  // is read by the owner's cookie too. Everything else on this page works the same.
  const [settings, summary, pairedPhones, scanCursor] = await Promise.all([
    getRequestSettings(),
    catalogSummary(db, teacherId),
    isOwner ? listActivePairings(db, teacherId) : [],
    isOwner ? latestScanEventSeq(db, teacherId) : 0,
  ]);

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href="/library" variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            Library
          </LinkButton>
        }
        title="Add books"
        subtitle="Scan a barcode, type an ISBN, or enter a book by hand."
      />
      <AddBooks
        readingLevelSystem={settings.readingLevelSystem}
        suggestions={{ tags: summary.tags, locations: summary.locations }}
        pairedPhones={pairedPhones.map((phone) => ({
          pairingId: phone.pairingId,
          deviceLabel: phone.deviceLabel,
          expiresLabel: describeExpiry(phone.expiresAt, settings.timeZone),
        }))}
        scanCursor={scanCursor}
        phonePairing={isOwner}
      />
    </>
  );
}
