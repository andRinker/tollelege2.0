import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { catalogSummary, listBooks } from "@/server/catalog";
import { listGenres } from "@/server/genres";
import { requireClassroom } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { EmptyState, PageHeader } from "@/ui/components/expressive";
import { Fab } from "@/ui/components/fab";
import { iconBarcodeScanner, iconChevronLeft, iconChevronRight, iconLibraryAdd, iconSearch } from "@/ui/icons/generated";
import { LIBRARY_VIEW_COOKIE, parseLibraryFilters, parseLibraryView } from "./filters";
import { LibraryFilters } from "./library-filters";
import { LibraryBooks } from "./library-books";

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
  // A co-teacher works in the owner's whole library; only deleting and lending stay the owner's.
  const { teacherId, isOwner } = await requireClassroom();
  const params = await searchParams;
  const filters = parseLibraryFilters(params);
  const db = getDb();
  const [result, summary, settings, cookieStore, genres] = await Promise.all([
    listBooks(db, teacherId, filters),
    catalogSummary(db, teacherId),
    getRequestSettings(),
    cookies(),
    listGenres(db, teacherId),
  ]);
  const view = parseLibraryView(cookieStore.get(LIBRARY_VIEW_COOKIE)?.value);
  const isFiltered = Boolean(
    filters.query || filters.tag || filters.readingLevel || filters.location || filters.genre || filters.availability !== "all",
  );

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
            genre={filters.genre}
            genres={genres.filter((genre) => genre.bookCount > 0)}
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
          ) : (
            <LibraryBooks
              books={result.items}
              view={view}
              total={result.total}
              readingLevelSystem={settings.readingLevelSystem}
              suggestions={{ tags: summary.tags, locations: summary.locations, genres }}
              genres={genres}
              canManage={isOwner}
            />
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

      {/* When books are showing, the list carries this button, so it can hide it while choosing. */}
      {summary.titles > 0 && result.items.length === 0 && (
        <div className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 medium:hidden">
          <Fab href="/library/add" icon={iconLibraryAdd} label="Add books" />
        </div>
      )}
    </>
  );
}
