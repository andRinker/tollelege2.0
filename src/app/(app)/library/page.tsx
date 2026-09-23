import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Availability } from "@/components/availability";
import { BookCover } from "@/components/book-cover";
import { getDb } from "@/db/client";
import { catalogSummary, listBooks } from "@/server/catalog";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { EmptyState, PageHeader } from "@/ui/components/expressive";
import { Fab } from "@/ui/components/fab";
import { CardLink } from "@/ui/components/surfaces";
import { iconBarcodeScanner, iconChevronLeft, iconChevronRight, iconLibraryAdd, iconSearch } from "@/ui/icons/generated";
import { LIBRARY_VIEW_COOKIE, parseLibraryFilters, parseLibraryView } from "./filters";
import { LibraryFilters } from "./library-filters";
import { LibraryList } from "./library-list";

export const metadata: Metadata = { title: "Library" };

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && key !== "page") next.set(key, value);
  }
  if (page > 1) next.set("page", String(page));
  const query = next.toString();
  return query ? `/library?${query}` : "/library";
}

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const { teacherId } = await requireTeacher();
  const params = await searchParams;
  const filters = parseLibraryFilters(params);
  const db = getDb();
  const [result, summary, settings, cookieStore] = await Promise.all([
    listBooks(db, teacherId, filters),
    catalogSummary(db, teacherId),
    getRequestSettings(),
    cookies(),
  ]);
  const view = parseLibraryView(cookieStore.get(LIBRARY_VIEW_COOKIE)?.value);
  const isFiltered = Boolean(filters.query || filters.tag || filters.readingLevel || filters.location || filters.availability !== "all");

  return (
    <>
      <PageHeader
        title="Library"
        subtitle={
          summary.titles > 0
            ? `${summary.titles} ${summary.titles === 1 ? "title" : "titles"} · ${summary.copies} ${summary.copies === 1 ? "copy" : "copies"}`
            : undefined
        }
        actions={
          summary.titles > 0 && (
            <LinkButton href="/library/add" icon={iconLibraryAdd} size="md" className="max-medium:hidden">
              Add books
            </LinkButton>
          )
        }
      />

      {summary.titles === 0 ? (
        <EmptyState
          icon={iconBarcodeScanner}
          title="Your library is empty"
          description="Scan the barcodes on your books, or type their ISBNs, and they'll appear here with covers and authors."
          action={
            <LinkButton href="/library/add" icon={iconLibraryAdd} size="md">
              Add your first books
            </LinkButton>
          }
        />
      ) : (
        <>
          <LibraryFilters
            query={filters.query ?? ""}
            availability={filters.availability}
            tag={filters.tag}
            level={filters.readingLevel}
            bin={filters.location}
            sort={filters.sort}
            view={view}
            tags={summary.tags}
            readingLevels={summary.readingLevels}
            locations={summary.locations}
          />

          {result.items.length === 0 ? (
            <EmptyState
              icon={iconSearch}
              shape="softBurst"
              title="No books match"
              description={isFiltered ? "Try a different search or clear the filters." : undefined}
              action={isFiltered && <LinkButton variant="tonal" href="/library">Clear filters</LinkButton>}
            />
          ) : view === "list" ? (
            <LibraryList
              books={result.items}
              readingLevelSystem={settings.readingLevelSystem}
              suggestions={{ tags: summary.tags, locations: summary.locations }}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 medium:grid-cols-3 expanded:grid-cols-4 large:grid-cols-5 xlarge:grid-cols-6">
              {result.items.map((book) => (
                <li key={book.id}>
                  <CardLink href={`/library/${book.id}`} variant="filled" className="flex h-full flex-col gap-2 bg-surface-container-low p-2 pb-3">
                    <BookCover title={book.title} coverUrl={book.coverUrl} />
                    <div className="flex flex-col gap-0.5 px-1">
                      <span className="line-clamp-2 text-title-sm text-on-surface">{book.title}</span>
                      {book.authors.length > 0 && (
                        <span className="truncate text-body-sm text-on-surface-variant">{book.authors.join(", ")}</span>
                      )}
                      <Availability available={book.availableCopies} total={book.totalCopies} className="pt-1" />
                    </div>
                  </CardLink>
                </li>
              ))}
            </ul>
          )}

          {result.pageCount > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-center gap-4 pt-6">
              <LinkButton
                variant="tonal"
                icon={iconChevronLeft}
                href={pageHref(params, result.page - 1)}
                isDisabled={result.page <= 1}
              >
                Previous
              </LinkButton>
              <span className="text-label-lg text-on-surface-variant">
                Page {result.page} of {result.pageCount}
              </span>
              <LinkButton
                variant="tonal"
                trailingIcon={iconChevronRight}
                href={pageHref(params, result.page + 1)}
                isDisabled={result.page >= result.pageCount}
              >
                Next
              </LinkButton>
            </nav>
          )}
        </>
      )}

      {summary.titles > 0 && (
        <div className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 medium:hidden">
          <Fab href="/library/add" icon={iconLibraryAdd} label="Add books" />
        </div>
      )}
    </>
  );
}
