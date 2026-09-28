"use client";

import { useState } from "react";
import { Availability } from "@/components/availability";
import { BookCover } from "@/components/book-cover";
import { GenreLabel } from "@/components/genre";
import { bookFormFromBook, type BookFormValue } from "@/components/book-form";
import type { ReadingLevelSystem } from "@/db/schema/enums";
import type { BookListItem, LibraryEntry, SeriesStack } from "@/server/catalog";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { List, ListItem } from "@/ui/components/list";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconBlock, iconDelete, iconEdit, iconSwapVert } from "@/ui/icons/generated";
import { bookForEditAction, setBookLendableAction } from "./actions";
import { type BookSuggestions, DeleteBookDialog, EditBookDialog } from "./book-dialogs";
import { StackCover } from "./stack-cover";

type Props = {
  entries: LibraryEntry[];
  /** Where a series stack opens. */
  seriesHref: (name: string) => string;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: BookSuggestions;
  /** False for a co-teacher, who can edit books but not delete them or change lending. */
  canManage?: boolean;
};

/**
 * The library as rows, for working through it rather than browsing it: each title carries
 * its three most-used actions, so tidying a shelf doesn't mean opening every book.
 */
export function LibraryList({ entries, seriesHref, readingLevelSystem, suggestions, canManage = true }: Props) {
  return (
    <List aria-label="Books">
      {entries.map((entry) =>
        entry.kind === "book" ? (
          <LibraryRow
            key={entry.book.id}
            book={entry.book}
            readingLevelSystem={readingLevelSystem}
            suggestions={suggestions}
            canManage={canManage}
          />
        ) : (
          <SeriesRow key={`series-${entry.series.name}`} stack={entry.series} href={seriesHref(entry.series.name)} />
        ),
      )}
    </List>
  );
}

/** A series as one row: its books are a tap away, and edited there. */
function SeriesRow({ stack, href }: { stack: SeriesStack; href: string }) {
  return (
    <ListItem
      href={href}
      leading={
        <div className="w-10">
          <StackCover stack={stack} size="sm" />
        </div>
      }
      headline={stack.name}
      supporting={
        <span className="flex flex-col gap-1">
          <span className="truncate">
            <span className="text-primary">{`${stack.count} books`}</span>
            {stack.first.authors.length > 0 && ` · ${stack.first.authors[0]}`}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Availability available={stack.availableCopies} total={stack.totalCopies} />
            {stack.genre && <GenreLabel genre={stack.genre} className="text-label-md text-on-surface-variant" />}
          </span>
        </span>
      }
    />
  );
}

function LibraryRow({ book, readingLevelSystem, suggestions, canManage }: { book: BookListItem } & Omit<Props, "entries" | "seriesHref">) {
  const showSnackbar = useSnackbar();
  const [editing, setEditing] = useState<BookFormValue | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Shown straight away, and put back if the server refuses (a copy away on loan, say).
  const [lendable, setLendable] = useState(book.lendable);
  const [savingLendable, setSavingLendable] = useState(false);

  async function edit() {
    // The list carries only what a row shows, so the full record is fetched on demand.
    setLoadingEdit(true);
    const result = await bookForEditAction(book.id);
    setLoadingEdit(false);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    setEditing(bookFormFromBook(result.data.book));
  }

  async function toggleLending() {
    const next = !lendable;
    setLendable(next);
    setSavingLendable(true);
    const result = await setBookLendableAction(book.id, next);
    setSavingLendable(false);
    if (!result.ok) {
      setLendable(!next);
      showSnackbar({ message: result.message });
      return;
    }
    showSnackbar({ message: next ? `${book.title} is offered for lending again` : `${book.title} is held back from lending` });
  }

  const lendingLabel = lendable ? "Exclude from lending" : "Include in lending";
  const lendingIcon = lendable ? iconBlock : iconSwapVert;

  return (
    <>
      <ListItem
        href={`/library/${book.id}`}
        leading={
          <div className="w-10">
            <BookCover title={book.title} coverUrl={book.coverUrl} size="sm" className="rounded-xs" />
          </div>
        }
        headline={book.title}
        supporting={
          <span className="flex flex-col gap-1">
            {book.authors.length > 0 && <span className="truncate">{book.authors.join(", ")}</span>}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Availability available={book.availableCopies} total={book.totalCopies} />
              {book.genre && <GenreLabel genre={book.genre} className="text-label-md text-on-surface-variant" />}
              {!lendable && (
                <span className="inline-flex items-center gap-1 text-label-md text-on-surface-variant">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-outline" />
                  Not lent
                </span>
              )}
            </span>
          </span>
        }
        actions={
          <>
            {/* Labelled where there's room; icons with the same names on a phone. Each set is a
                group named for the book, so a screen reader hears which "Delete" this is. */}
            <div role="group" aria-label={book.title} className="flex w-52 flex-col items-stretch gap-1 py-2 max-medium:hidden [&>*]:justify-start">
              <Button variant="tonal" size="xs" icon={iconEdit} isPending={loadingEdit} onPress={() => void edit()}>
                Edit details
              </Button>
              {canManage && (
                <Button variant="text" size="xs" icon={lendingIcon} isPending={savingLendable} onPress={() => void toggleLending()}>
                  {lendingLabel}
                </Button>
              )}
              {canManage && (
                <Button variant="text" size="xs" icon={iconDelete} onPress={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
            <div role="group" aria-label={book.title} className="flex items-center medium:hidden">
              <IconButton icon={iconEdit} label="Edit details" isPending={loadingEdit} onPress={() => void edit()} />
              {canManage && (
                <IconButton icon={lendingIcon} label={lendingLabel} isPending={savingLendable} onPress={() => void toggleLending()} />
              )}
              {canManage && <IconButton icon={iconDelete} label="Delete" onPress={() => setConfirmDelete(true)} />}
            </div>
          </>
        }
      />
      <EditBookDialog
        bookId={book.id}
        value={editing}
        onChange={setEditing}
        readingLevelSystem={readingLevelSystem}
        suggestions={suggestions}
      />
      <DeleteBookDialog bookId={book.id} title={book.title} isOpen={confirmDelete} onOpenChange={setConfirmDelete} />
    </>
  );
}
