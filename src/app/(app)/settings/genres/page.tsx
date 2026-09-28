import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { listGenres } from "@/server/genres";
import { requireTeacher } from "@/server/session";
import { LinkButton } from "@/ui/components/button";
import { PageHeader } from "@/ui/components/expressive";
import { iconArrowBack } from "@/ui/icons/generated";
import { GenresEditor } from "./genres-editor";

export const metadata: Metadata = { title: "Genres" };

export default async function GenresPage() {
  // Always the teacher's own genres, whichever classroom they're working in.
  const { teacherId } = await requireTeacher();
  const genres = await listGenres(getDb(), teacherId);

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href="/settings" variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            Settings
          </LinkButton>
        }
        title="Genres"
        subtitle="One for each colour of dot on your shelves. Two genres can share a colour."
      />
      <div className="max-w-2xl">
        <GenresEditor genres={genres} />
      </div>
    </>
  );
}
