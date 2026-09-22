import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { getDb } from "@/db/client";
import { listConnections } from "@/server/connections";
import { browseShelf } from "@/server/lending";
import { requireTeacher } from "@/server/session";
import { LinkButton } from "@/ui/components/button";
import { Card } from "@/ui/components/surfaces";
import { EmptyState, PageHeader } from "@/ui/components/expressive";
import { SearchField } from "@/ui/components/text-field";
import { iconArrowBack, iconChevronLeft, iconChevronRight, iconSearch, iconShelves } from "@/ui/icons/generated";
import { RequestBookButton } from "./request-book";

export const metadata: Metadata = { title: "Shelves" };

export default async function ShelfPage({ params, searchParams }: PageProps<"/lending/shelf/[teacherId]">) {
  const { teacherId } = await requireTeacher();
  const { teacherId: ownerId } = await params;
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q : "";
  const page = Number(typeof query.page === "string" ? query.page : "1") || 1;

  const db = getDb();
  const peer = (await listConnections(db, teacherId)).peers.find((row) => row.teacherId === ownerId);
  if (!peer) notFound();

  const shelf = await browseShelf(db, teacherId, ownerId, { query: search, page });

  function pageHref(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const rest = params.toString();
    return rest ? `/lending/shelf/${ownerId}?${rest}` : `/lending/shelf/${ownerId}`;
  }

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href="/lending" variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            Lending
          </LinkButton>
        }
        title={`${peer.name}’s shelves`}
        subtitle={
          shelf.total > 0 ? `${shelf.total} ${shelf.total === 1 ? "title" : "titles"} offered` : undefined
        }
      />

      <form method="get" action={`/lending/shelf/${ownerId}`} className="pb-4">
        <SearchField name="q" defaultValue={search} placeholder="Search their titles and authors" />
      </form>

      {shelf.items.length === 0 ? (
        <EmptyState
          icon={search ? iconSearch : iconShelves}
          shape={search ? "softBurst" : "cookie9"}
          title={search ? "No books match" : `${peer.name} isn’t offering any books yet`}
          description={
            search
              ? "Try a different search."
              : "Books appear here as soon as they add them, unless they hold a title back."
          }
          action={
            search && (
              <LinkButton variant="tonal" href={`/lending/shelf/${ownerId}`}>
                Clear search
              </LinkButton>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 medium:grid-cols-3 expanded:grid-cols-4 large:grid-cols-5 xlarge:grid-cols-6">
          {shelf.items.map((book) => (
            <li key={book.id}>
              <Card variant="filled" className="flex h-full flex-col gap-2 bg-surface-container-low p-2 pb-3">
                <BookCover title={book.title} coverUrl={book.coverUrl} />
                <div className="flex grow flex-col gap-0.5 px-1">
                  <span className="line-clamp-2 text-title-sm text-on-surface">{book.title}</span>
                  {book.authors.length > 0 && (
                    <span className="truncate text-body-sm text-on-surface-variant">{book.authors.join(", ")}</span>
                  )}
                  <span className="pt-1 text-label-sm text-on-surface-variant">
                    {book.availableCopies === 0
                      ? "All copies out"
                      : `${book.availableCopies} free`}
                  </span>
                </div>
                <div className="px-1">
                  <RequestBookButton
                    ownerTeacherId={ownerId}
                    ownerName={peer.name}
                    bookId={book.id}
                    title={book.title}
                    availableCopies={book.availableCopies}
                    standing={book.standing}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {shelf.pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-4 pt-6">
          <LinkButton variant="tonal" icon={iconChevronLeft} href={pageHref(shelf.page - 1)} isDisabled={shelf.page <= 1}>
            Previous
          </LinkButton>
          <span className="text-label-lg text-on-surface-variant">
            Page {shelf.page} of {shelf.pageCount}
          </span>
          <LinkButton
            variant="tonal"
            trailingIcon={iconChevronRight}
            href={pageHref(shelf.page + 1)}
            isDisabled={shelf.page >= shelf.pageCount}
          >
            Next
          </LinkButton>
        </nav>
      )}
    </>
  );
}
