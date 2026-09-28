"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Checkbox as AriaCheckbox, Form } from "react-aria-components";
import { Availability } from "@/components/availability";
import { BookCover } from "@/components/book-cover";
import { GenreDot, GenreLabel, type GenreOption } from "@/components/genre";
import type { ReadingLevelSystem } from "@/db/schema/enums";
import { READING_LEVEL_FIELD_LABELS } from "@/lib/reading-levels";
import type { BookListItem, BulkOutcome, LibraryEntry, SeriesStack } from "@/server/catalog";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { Fab } from "@/ui/components/fab";
import { Icon } from "@/ui/components/icon";
import { ListBoxItem, Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { ComboBox } from "@/ui/components/select";
import { Checkbox } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import { CardLink } from "@/ui/components/surfaces";
import { TextField } from "@/ui/components/text-field";
import {
  iconBlock,
  iconCategory,
  iconCheck,
  iconDelete,
  iconLibraryAdd,
  iconLibraryAddCheck,
  iconShelves,
  iconSwapVert,
} from "@/ui/icons/generated";
import {
  bulkDeleteBooksAction,
  bulkEditBooksAction,
  bulkSetLendableAction,
  matchingBookIdsAction,
} from "./actions";
import type { BookSuggestions } from "./book-dialogs";
import type { LibraryView } from "./filters";
import { LibraryList } from "./library-list";
import { StackCover } from "./stack-cover";

type Props = {
  entries: LibraryEntry[];
  view: LibraryView;
  /** Books the filters select across every page. */
  total: number;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: BookSuggestions;
  genres: GenreOption[];
  /** False for a co-teacher: no deleting, no lending changes. */
  canManage: boolean;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Deleted 18 books. 2 were left: a copy of Hatchet is checked out." */
function describeOutcome(verb: string, outcome: BulkOutcome): string {
  const done = `${verb} ${plural(outcome.done, "book")}.`;
  if (outcome.skipped.length === 0) return done;
  const [first] = outcome.skipped;
  const rest = outcome.skipped.length > 1 ? ` (and ${plural(outcome.skipped.length - 1, "other")})` : "";
  return `${done} Left ${first.title}${rest}: ${first.reason}`;
}

/**
 * The library's books, as a grid or a list, and the way to act on many at once. "Select" turns
 * every book into a checkbox; the bar that appears sets a genre, a bin, a reading level or
 * lending on all of them, or deletes them. Each book keeps its own rules: one that's checked out
 * isn't deleted, and the bar says which were left.
 */
export function LibraryBooks({ entries, view, total, readingLevelSystem, suggestions, genres, canManage }: Props) {
  const showSnackbar = useSnackbar();
  const searchParams = useSearchParams();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"bin" | "level" | "delete" | null>(null);
  const [text, setText] = useState("");

  // A stack stands for all of its books, so choosing it chooses every one.
  const onPage = entries.flatMap((entry) => (entry.kind === "book" ? [entry.book.id] : entry.series.bookIds));
  const seriesHref = useSeriesHref();
  const pageSelected = onPage.filter((id) => selected.has(id)).length;

  function stop() {
    setSelecting(false);
    setSelected(new Set());
  }

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dialog === null) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, dialog]);

  function toggle(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function togglePage(on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of onPage) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function selectAllMatching() {
    setBusy(true);
    const result = await matchingBookIdsAction(Object.fromEntries(searchParams.entries()));
    setBusy(false);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    setSelected(new Set(result.data.ids));
  }

  /** Runs one bulk action on the selection, reports it, and starts the selection over. */
  async function run<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, describe: (data: T) => string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setDialog(null);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    showSnackbar({ message: describe(result.data) });
    setSelected(new Set());
  }

  const ids = [...selected];
  const count = ids.length;
  const setGenre = (genreId: string | null) =>
    run(
      () => bulkEditBooksAction(ids, { genreId }),
      ({ updated }) => {
        const name = genres.find((genre) => genre.id === genreId)?.name;
        return name ? `${plural(updated, "book")} set to ${name}` : `${plural(updated, "book")} now have no genre`;
      },
    );

  return (
    <>
      <div className="flex min-h-12 flex-wrap items-center justify-end gap-2 pb-2">
        {selecting ? (
          <>
            <Checkbox
              isSelected={pageSelected === onPage.length && onPage.length > 0}
              isIndeterminate={pageSelected > 0 && pageSelected < onPage.length}
              onChange={togglePage}
              className="mr-auto text-body-md"
            >
              Select all on this page
            </Checkbox>
            {total > onPage.length && (
              <Button variant="text" size="sm" isPending={busy} onPress={() => void selectAllMatching()}>
                {`Select all ${total}`}
              </Button>
            )}
            <Button variant="tonal" size="sm" onPress={stop}>
              Done
            </Button>
          </>
        ) : (
          <Button variant="text" size="sm" icon={iconLibraryAddCheck} onPress={() => setSelecting(true)}>
            Select
          </Button>
        )}
      </div>

      {selecting ? (
        <ul
          aria-label="Books to select"
          className={
            view === "grid"
              ? "grid grid-cols-2 gap-3 medium:grid-cols-3 expanded:grid-cols-4 large:grid-cols-5 xlarge:grid-cols-6"
              : "flex flex-col gap-1"
          }
        >
          {entries.map((entry) =>
            entry.kind === "book" ? (
              <li key={entry.book.id}>
                <SelectableBook
                  book={entry.book}
                  layout={view}
                  isSelected={selected.has(entry.book.id)}
                  onChange={(on) => toggle([entry.book.id], on)}
                />
              </li>
            ) : (
              <li key={`series-${entry.series.name}`}>
                <SelectableStack
                  stack={entry.series}
                  layout={view}
                  chosen={entry.series.bookIds.filter((id) => selected.has(id)).length}
                  onChange={(on) => toggle(entry.series.bookIds, on)}
                />
              </li>
            ),
          )}
        </ul>
      ) : view === "list" ? (
        <LibraryList entries={entries} seriesHref={seriesHref} readingLevelSystem={readingLevelSystem} suggestions={suggestions} canManage={canManage} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 medium:grid-cols-3 expanded:grid-cols-4 large:grid-cols-5 xlarge:grid-cols-6">
          {entries.map((entry) =>
            entry.kind === "book" ? (
              <li key={entry.book.id}>
                <CardLink href={`/library/${entry.book.id}`} variant="filled" className="flex h-full flex-col gap-2 bg-surface-container-low p-2 pb-3">
                  <BookCover title={entry.book.title} coverUrl={entry.book.coverUrl} />
                  <BookText book={entry.book} />
                </CardLink>
              </li>
            ) : (
              <li key={`series-${entry.series.name}`}>
                <CardLink
                  href={seriesHref(entry.series.name)}
                  variant="filled"
                  aria-label={`${entry.series.name}, ${plural(entry.series.count, "book")}`}
                  className="flex h-full flex-col gap-2 bg-surface-container-low p-2 pb-3"
                >
                  <StackCover stack={entry.series} />
                  <StackText stack={entry.series} />
                </CardLink>
              </li>
            ),
          )}
        </ul>
      )}

      {/* Room at the end so the bar never covers the last row. */}
      {selecting && <div aria-hidden="true" className="h-28" />}

      {selecting ? (
        <div
          role="toolbar"
          aria-label="Selected books"
          className="fixed inset-x-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl bg-surface-container-highest p-3 shadow-3 medium:bottom-6"
        >
          <span className="mr-auto px-2 text-label-lg" aria-live="polite">
            {count === 0 ? "Choose books" : `${plural(count, "book")} selected`}
          </span>
          <MenuTrigger>
            <Button variant="tonal" size="sm" icon={iconCategory} isDisabled={count === 0 || busy}>
              Genre
            </Button>
            <Menu onAction={(key) => void setGenre(key === "none" ? null : String(key))}>
              {[
                ...genres.map((genre) => (
                  <MenuItem key={genre.id} id={genre.id} textValue={genre.name}>
                    <span className="flex items-center gap-2">
                      <GenreDot color={genre.color} />
                      {genre.name}
                    </span>
                  </MenuItem>
                )),
                <MenuItem key="none" id="none">
                  No genre
                </MenuItem>,
              ]}
            </Menu>
          </MenuTrigger>
          <Button variant="tonal" size="sm" icon={iconShelves} isDisabled={count === 0 || busy} onPress={() => (setText(""), setDialog("bin"))}>
            Bin
          </Button>
          {readingLevelSystem !== "none" && (
            <Button variant="tonal" size="sm" isDisabled={count === 0 || busy} onPress={() => (setText(""), setDialog("level"))}>
              Level
            </Button>
          )}
          {canManage && (
            <MenuTrigger>
              <Button variant="tonal" size="sm" icon={iconSwapVert} isDisabled={count === 0 || busy}>
                Lending
              </Button>
              <Menu
                onAction={(key) => {
                  const lendable = key === "offer";
                  void run(
                    () => bulkSetLendableAction(ids, lendable),
                    (outcome) => describeOutcome(lendable ? "Offered" : "Held back", outcome),
                  );
                }}
              >
                <MenuItem id="offer" icon={iconSwapVert}>
                  Offer for lending
                </MenuItem>
                <MenuItem id="hold" icon={iconBlock}>
                  Hold back from lending
                </MenuItem>
              </Menu>
            </MenuTrigger>
          )}
          {canManage && (
            <Button variant="tonal" size="sm" icon={iconDelete} isDisabled={count === 0 || busy} onPress={() => setDialog("delete")}>
              Delete
            </Button>
          )}
        </div>
      ) : (
        <div className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 medium:hidden">
          <Fab href="/library/add" icon={iconLibraryAdd} label="Add books" />
        </div>
      )}

      <Dialog
        isOpen={dialog === "bin" || dialog === "level"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === "bin" ? `Bin or shelf for ${plural(count, "book")}` : `${readingLevelSystem !== "none" ? READING_LEVEL_FIELD_LABELS[readingLevelSystem] : "Level"} for ${plural(count, "book")}`}
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button type="submit" form="bulk-field-form" isPending={busy}>
              Save
            </Button>
          </>
        )}
      >
        <Form
          id="bulk-field-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim() || null;
            if (dialog === "bin") {
              void run(
                () => bulkEditBooksAction(ids, { location: value }),
                ({ updated }) => (value ? `${plural(updated, "book")} moved to ${value}` : `${plural(updated, "book")} now have no bin`),
              );
            } else {
              void run(
                () => bulkEditBooksAction(ids, { readingLevel: value }),
                ({ updated }) => (value ? `${plural(updated, "book")} set to level ${value}` : `${plural(updated, "book")} now have no level`),
              );
            }
          }}
          className="flex flex-col gap-3 pt-1 [--field-bg:var(--md-sys-color-surface-container-high)]"
        >
          {dialog === "bin" ? (
            <ComboBox
              label="Bin or shelf"
              leadingIcon={iconShelves}
              allowsCustomValue
              inputValue={text}
              onInputChange={setText}
              defaultItems={suggestions.locations.map((location) => ({ id: location, name: location }))}
              menuTrigger="focus"
              description="Leave it empty to clear the bin."
            >
              {(item: { id: string; name: string }) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
            </ComboBox>
          ) : (
            <TextField
              label={readingLevelSystem !== "none" ? READING_LEVEL_FIELD_LABELS[readingLevelSystem] : "Level"}
              value={text}
              onChange={setText}
              maxLength={20}
              description="Leave it empty to clear the level."
              autoFocus
            />
          )}
        </Form>
      </Dialog>

      <ConfirmDialog
        isOpen={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Delete ${plural(count, "book")}?`}
        message="Every copy of each goes, and this can't be undone. Students keep them in their reading history. A book that's checked out or away on loan is left in place."
        confirmLabel="Delete"
        destructive
        onConfirm={() => run(() => bulkDeleteBooksAction(ids), (outcome) => describeOutcome("Deleted", outcome))}
      />
    </>
  );
}

/** Where a stack opens: the same library, showing only that series, with the filters kept. */
export function useSeriesHref() {
  const searchParams = useSearchParams();
  return (name: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    next.delete("q");
    next.set("series", name);
    return `/library?${next.toString()}`;
  };
}

/** A stack's series name, how many books, its first author, a shared genre and availability. */
function StackText({ stack }: { stack: SeriesStack }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-1">
      <span className="line-clamp-2 text-title-sm text-on-surface">{stack.name}</span>
      <span className="text-body-sm text-primary">{plural(stack.count, "book")}</span>
      {stack.first.authors.length > 0 && <span className="truncate text-body-sm text-on-surface-variant">{stack.first.authors[0]}</span>}
      {stack.genre && <GenreLabel genre={stack.genre} className="text-label-md text-on-surface-variant" />}
      <Availability available={stack.availableCopies} total={stack.totalCopies} className="pt-1" />
    </div>
  );
}

/** A stack as a checkbox: ticking it chooses every book in it. Part-chosen shows as a dash. */
function SelectableStack({
  stack,
  layout,
  chosen,
  onChange,
}: {
  stack: SeriesStack;
  layout: LibraryView;
  chosen: number;
  onChange: (selected: boolean) => void;
}) {
  const all = chosen === stack.count;
  return (
    <AriaCheckbox
      isSelected={all}
      isIndeterminate={chosen > 0 && !all}
      onChange={onChange}
      aria-label={`${stack.name}, ${plural(stack.count, "book")}`}
      className={cx(
        "group relative flex h-full cursor-pointer rounded-md bg-surface-container-low outline-none transition-colors",
        "data-[selected]:bg-secondary-container data-[indeterminate]:bg-secondary-container/60 data-[focus-visible]:outline-3 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-secondary",
        layout === "grid" ? "flex-col gap-2 p-2 pb-3" : "items-center gap-3 px-3 py-2",
      )}
    >
      <div className={layout === "grid" ? "relative" : "relative w-10 shrink-0"}>
        <StackCover stack={stack} size={layout === "grid" ? undefined : "sm"} />
      </div>
      <StackText stack={stack} />
      <span
        aria-hidden="true"
        className={cx(
          "grid size-7 place-items-center rounded-full border-2",
          layout === "grid" ? "absolute top-3 right-3" : "ml-auto shrink-0",
          all ? "border-primary bg-primary text-on-primary" : chosen > 0 ? "border-primary bg-surface text-primary" : "border-outline bg-surface/80 text-transparent",
        )}
      >
        {chosen > 0 && !all ? <span className="h-0.5 w-3 rounded-full bg-primary" /> : <Icon icon={iconCheck} size={18} />}
      </span>
    </AriaCheckbox>
  );
}

/** A book's title, author, genre and availability, as a tile shows them. */
function BookText({ book }: { book: BookListItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-1">
      <span className="line-clamp-2 text-title-sm text-on-surface">{book.title}</span>
      {book.authors.length > 0 && <span className="truncate text-body-sm text-on-surface-variant">{book.authors.join(", ")}</span>}
      {book.genre && <GenreLabel genre={book.genre} className="text-label-md text-on-surface-variant" />}
      <Availability available={book.availableCopies} total={book.totalCopies} className="pt-1" />
    </div>
  );
}

/** A book as a checkbox: the whole tile or row toggles it, and a tick shows it's chosen. */
function SelectableBook({
  book,
  layout,
  isSelected,
  onChange,
}: {
  book: BookListItem;
  layout: LibraryView;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
}) {
  return (
    <AriaCheckbox
      isSelected={isSelected}
      onChange={onChange}
      aria-label={book.title}
      className={cx(
        "group relative flex h-full cursor-pointer rounded-md bg-surface-container-low outline-none transition-colors",
        "data-[selected]:bg-secondary-container data-[focus-visible]:outline-3 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-secondary",
        layout === "grid" ? "flex-col gap-2 p-2 pb-3" : "items-center gap-3 px-3 py-2",
      )}
    >
      {({ isSelected: checked }) => (
        <>
          <div className={layout === "grid" ? "relative" : "relative w-10 shrink-0"}>
            <BookCover title={book.title} coverUrl={book.coverUrl} size={layout === "grid" ? undefined : "sm"} />
          </div>
          <BookText book={book} />
          <span
            aria-hidden="true"
            className={cx(
              "grid size-7 place-items-center rounded-full border-2",
              layout === "grid" ? "absolute top-3 right-3" : "ml-auto shrink-0",
              checked ? "border-primary bg-primary text-on-primary" : "border-outline bg-surface/80 text-transparent",
            )}
          >
            <Icon icon={iconCheck} size={18} />
          </span>
        </>
      )}
    </AriaCheckbox>
  );
}
