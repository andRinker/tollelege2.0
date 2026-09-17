import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { catalogSummary } from "@/server/catalog";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { PageHeader } from "@/ui/components/expressive";
import { iconArrowBack } from "@/ui/icons/generated";
import { AddBooks } from "./add-books";

export const metadata: Metadata = { title: "Add books" };

export default async function AddBooksPage() {
  const { teacherId } = await requireTeacher();
  const [settings, summary] = await Promise.all([getRequestSettings(), catalogSummary(getDb(), teacherId)]);

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
      />
    </>
  );
}
