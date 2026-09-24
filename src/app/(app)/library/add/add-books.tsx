"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Form } from "react-aria-components";
import { BarcodeScannerDialog } from "@/components/barcode-scanner";
import { BookCover } from "@/components/book-cover";
import { useBarcodeWedge } from "@/components/use-barcode-wedge";
import {
  BookFields,
  bookFormFromMetadata,
  bookInputFromForm,
  type BookFormValue,
  CopyCountStepper,
  EMPTY_BOOK,
  ShelvingFields,
} from "@/components/book-form";
import type { ReadingLevelSystem } from "@/db/schema/enums";
import { formatIsbn13, normalizeIsbn } from "@/lib/isbn";
import type { QuickAddResult } from "@/server/catalog";
import type { ShelfSlot, ShelfTally } from "@/server/shelf-scan";
import { cx } from "@/ui/cx";
import { Button, LinkButton } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { Icon } from "@/ui/components/icon";
import { IconButton } from "@/ui/components/icon-button";
import { LoadingIndicator } from "@/ui/components/loading-indicator";
import { Switch } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import {
  iconBarcodeScanner,
  iconCheckCircle,
  iconEdit,
  iconError,
  iconLibraryAdd,
  iconPhotoCamera,
  iconRefresh,
  iconSearch,
  iconUndo,
} from "@/ui/icons/generated";
import { springs } from "@/ui/motion/tokens";
import {
  addBookAction,
  addCopyAction,
  type LookupActionResult,
  lookupIsbnAction,
  quickAddAction,
  undoQuickAddAction,
} from "../actions";
import { type PairedPhone, PhonePairing } from "./phone-pairing";
import { type GapFill, ShelfScanDialog } from "./shelf-scan";
import { type ScanFeedEvent, useScanFeed } from "./use-scan-feed";

type Suggestions = { tags: string[]; locations: string[] };

type LookupState = { status: "idle" } | { status: "loading"; isbn13: string } | Exclude<LookupActionResult, { status: "invalid" }>;

type ScanEntry = {
  key: string;
  isbn13: string;
  state: "loading" | "added" | "not_found" | "unavailable" | "error" | "undone";
  result?: QuickAddResult;
  message?: string;
};

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("flex flex-col gap-4 rounded-xl bg-surface-container-low p-4 medium:p-6 [--field-bg:var(--md-sys-color-surface-container-low)]", className)}>
      {children}
    </section>
  );
}

type AddBooksProps = {
  readingLevelSystem: ReadingLevelSystem;
  suggestions: Suggestions;
  pairedPhones: PairedPhone[];
  /** Where the scan feed stood when the page rendered. */
  scanCursor: number;
  /** Whether to offer a phone as the scanner. Off in a classroom you co-teach. */
  phonePairing?: boolean;
};

export function AddBooks({ readingLevelSystem, suggestions, pairedPhones, scanCursor, phonePairing = true }: AddBooksProps) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isbnInput, setIsbnInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [rapid, setRapid] = useState(false);
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manual, setManual] = useState<BookFormValue | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [phoneScanning, setPhoneScanning] = useState(false);
  const [incomingShelf, setIncomingShelf] = useState<{ slots: ShelfSlot[]; tally?: ShelfTally; otherShelf?: number; at: number } | null>(null);
  /**
   * A gap in the shelf review waiting for the next scan. It lives here rather than in the
   * dialog because this is where scans arrive — from the phone, the USB wedge or the
   * camera — and an armed gap is simply the answer to "where should the next one go?".
   */
  const [armedGap, setArmedGap] = useState<number | null>(null);
  const [gapFills, setGapFills] = useState<Record<number, GapFill>>({});
  /** The gap the manual form was opened for, so its row can be closed off on save. */
  const [handGap, setHandGap] = useState<number | null>(null);

  const fillGap = useCallback(
    (position: number, fill: GapFill) => {
      setGapFills((current) => ({ ...current, [position]: fill }));
      setArmedGap(null);
      router.refresh();
    },
    [router],
  );

  /** Returns a message to show on the row, or null when the gap is filled. */
  async function addIntoGap(position: number, raw: string): Promise<string | null> {
    const isbn13 = normalizeIsbn(raw);
    if (!isbn13) return "That isn't a valid ISBN.";
    const response = await quickAddAction(isbn13);
    switch (response.status) {
      case "added":
        fillGap(position, {
          title: response.result.title,
          note:
            response.result.outcome === "copy_added"
              ? `Added a copy — ${response.result.totalCopies} in all`
              : "Added",
        });
        return null;
      case "not_found":
        return "No catalogue has that ISBN.";
      case "unavailable":
        return "Couldn't reach the catalogues. Try again.";
      case "error":
        return response.message;
      default:
        return "That isn't a valid ISBN.";
    }
  }

  /**
   * A paired phone has already done the adding by the time we hear about it, so these
   * arrive as finished entries rather than going through `quickAdd`. They join the same
   * session list as a USB scan, with the same undo.
   */
  const onScanEvents = useCallback((events: ScanFeedEvent[]) => {
    setPhoneScanning(true);
    const scanned: ScanEntry[] = [];
    for (const event of events) {
      if (event.kind === "book_added") {
        if (armedGap !== null) {
          fillGap(armedGap, {
            title: event.payload.result.title,
            note:
              event.payload.result.outcome === "copy_added"
                ? `Added a copy — ${event.payload.result.totalCopies} in all`
                : "Added",
          });
          continue;
        }
        scanned.push({
          key: `phone-${event.seq}`,
          isbn13: event.payload.isbn13,
          state: "added",
          result: event.payload.result,
        });
      } else if (event.kind === "lookup_failed") {
        scanned.push({
          key: `phone-${event.seq}`,
          isbn13: "isbn13" in event.payload ? event.payload.isbn13 : "",
          state: event.payload.status === "invalid" ? "error" : event.payload.status,
          message: event.payload.status === "invalid" ? "That isn't a valid ISBN." : undefined,
        });
      } else {
        // A shelf from the phone still gets confirmed here, exactly like one taken here.
        // A new shelf resets everything the last one was waiting on.
        setArmedGap(null);
        setGapFills({});
        setIncomingShelf({ slots: event.payload.slots, tally: event.payload.tally, otherShelf: event.payload.otherShelf, at: event.seq });
        setShelfOpen(true);
      }
    }
    if (scanned.length === 0) return;
    // A phone scanning into a list nobody is looking at is the easiest way to lose a book.
    setRapid(true);
    setEntries((current) => [...scanned.reverse(), ...current]);
    router.refresh();
  }, [router, armedGap, fillGap]);

  useScanFeed(phonePairing, scanCursor, onScanEvents);

  function refocus() {
    setIsbnInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function lookUp(isbn13: string) {
    setLookup({ status: "loading", isbn13 });
    const result = await lookupIsbnAction(isbn13);
    if (result.status === "invalid") {
      setLookup({ status: "idle" });
      setInputError("That isn't a valid ISBN. Check the digits and try again.");
      return;
    }
    setLookup(result);
  }

  async function quickAdd(isbn13: string) {
    // An armed gap is asking for exactly this scan, so it takes precedence over the list.
    if (armedGap !== null) {
      await addIntoGap(armedGap, isbn13);
      return;
    }
    const key = `${isbn13}-${Date.now()}`;
    setEntries((current) => [{ key, isbn13, state: "loading" }, ...current]);
    const response = await quickAddAction(isbn13);
    setEntries((current) =>
      current.map((entry) => {
        if (entry.key !== key) return entry;
        switch (response.status) {
          case "added":
            return { ...entry, state: "added", result: response.result };
          case "error":
            return { ...entry, state: "error", message: response.message };
          case "invalid":
            return { ...entry, state: "error", message: "That isn't a valid ISBN." };
          default:
            return { ...entry, state: response.status };
        }
      }),
    );
  }

  function submitIsbn(raw: string) {
    const isbn13 = normalizeIsbn(raw);
    if (!isbn13) {
      setInputError(raw.trim() ? "That isn't a valid ISBN. Check the digits and try again." : "Enter or scan an ISBN.");
      return;
    }
    setInputError(null);
    refocus();
    // An armed gap already said where this scan goes, so it doesn't wait on rapid scan
    // being switched on — `quickAdd` hands it straight to the gap.
    if (rapid || armedGap !== null) void quickAdd(isbn13);
    else void lookUp(isbn13);
  }

  // A scan still works when focus has wandered to a button.
  useBarcodeWedge(submitIsbn, !scannerOpen);

  async function undo(entry: ScanEntry) {
    if (!entry.result) return;
    const response = await undoQuickAddAction(entry.result.copyId);
    if (!response.ok) {
      showSnackbar({ message: response.message });
      return;
    }
    setEntries((current) => current.map((item) => (item.key === entry.key ? { ...item, state: "undone" } : item)));
  }

  const addedCount = entries.filter((entry) => entry.state === "added").length;
  const lastEntry = entries[0];

  return (
    <div className="grid grid-cols-1 gap-4 expanded:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] expanded:items-start">
      <Section>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submitIsbn(isbnInput);
          }}
          className="flex flex-col gap-4"
        >
          <TextField
            label="ISBN"
            leadingIcon={iconBarcodeScanner}
            value={isbnInput}
            onChange={(value) => {
              setIsbnInput(value);
              setInputError(null);
            }}
            isInvalid={Boolean(inputError)}
            errorMessage={inputError ?? undefined}
            description="Using a USB barcode scanner? Click here, then scan."
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            inputClassName="tabular-nums"
            inputRef={inputRef}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="md" icon={rapid ? iconLibraryAdd : iconSearch} className="grow medium:grow-0">
              {rapid ? "Add" : "Look up"}
            </Button>
            <Button variant="tonal" size="md" icon={iconPhotoCamera} onPress={() => setScannerOpen(true)} className="grow medium:grow-0">
              Scan with camera
            </Button>
          </div>
        </Form>
        <div className="rounded-lg bg-surface-container px-4 py-3">
          <Switch isSelected={rapid} onChange={setRapid}>
            <span className="flex flex-col">
              <span className="text-body-lg">Rapid scan</span>
              <span className="text-body-sm text-on-surface-variant">Add each book as soon as it&rsquo;s scanned</span>
            </span>
          </Switch>
        </div>
        <Button variant="tonal" size="md" icon={iconPhotoCamera} onPress={() => setShelfOpen(true)} className="self-start">
          Photograph a shelf
        </Button>
        <Button variant="text" icon={iconEdit} className="self-start" onPress={() => setManual({ ...EMPTY_BOOK })}>
          Add a book without an ISBN
        </Button>
      </Section>

      {phonePairing && (
        <Section className="expanded:col-start-1">
          <PhonePairing paired={pairedPhones} connected={phoneScanning} />
        </Section>
      )}

      <div className="flex min-w-0 flex-col gap-4">
        {rapid ? (
          <RapidScanList entries={entries} addedCount={addedCount} onUndo={undo} onEnterDetails={(isbn13) => setManual({ ...EMPTY_BOOK, isbn: isbn13 })} onRetry={(isbn13) => quickAdd(isbn13)} />
        ) : (
          <LookupResult
            state={lookup}
            readingLevelSystem={readingLevelSystem}
            suggestions={suggestions}
            onDone={(message, bookId) => {
              setLookup({ status: "idle" });
              refocus();
              showSnackbar({ message, action: bookId ? { label: "View", onAction: () => router.push(`/library/${bookId}`) } : undefined });
            }}
            onEnterDetails={(isbn13) => setManual({ ...EMPTY_BOOK, isbn: isbn13 })}
            onRetry={(isbn13) => lookUp(isbn13)}
          />
        )}
      </div>

      {/* Remounted per arriving shelf, so a second photo replaces the first outright. */}
      <ShelfScanDialog
        key={incomingShelf?.at ?? "own-photo"}
        isOpen={shelfOpen}
        onOpenChange={(open) => {
          setShelfOpen(open);
          if (!open) setArmedGap(null);
        }}
        incoming={incomingShelf ?? undefined}
        armedPosition={armedGap}
        onArm={setArmedGap}
        gapResults={gapFills}
        onFillGap={addIntoGap}
        onAddByHand={(position, title) => {
          setHandGap(position);
          setManual({ ...EMPTY_BOOK, title });
        }}
      />

      <BarcodeScannerDialog
        isOpen={scannerOpen}
        onOpenChange={setScannerOpen}
        title={rapid ? "Rapid scan" : "Scan a barcode"}
        onDetected={(isbn13) => {
          if (rapid || armedGap !== null) {
            void quickAdd(isbn13);
          } else {
            setScannerOpen(false);
            void lookUp(isbn13);
          }
        }}
        status={
          rapid && lastEntry ? (
            <p className="text-center text-title-md">
              {lastEntry.state === "loading"
                ? `Looking up ${formatIsbn13(lastEntry.isbn13)}…`
                : lastEntry.state === "added"
                  ? `${lastEntry.result?.outcome === "copy_added" ? "Added a copy of" : "Added"} ${lastEntry.result?.title}`
                  : `Couldn't add ${formatIsbn13(lastEntry.isbn13)}`}
              <span className="block text-body-md text-on-surface-variant">{addedCount} added so far</span>
            </p>
          ) : undefined
        }
      />

      <ManualEntryDialog
        value={manual}
        onChange={setManual}
        readingLevelSystem={readingLevelSystem}
        suggestions={suggestions}
        onAdded={(title, bookId, isbn13) => {
          setManual(null);
          if (handGap !== null) {
            fillGap(handGap, { title, note: "Added by hand" });
            setHandGap(null);
          }
          if (isbn13) setEntries((current) => current.filter((entry) => !(entry.state === "not_found" && entry.isbn13 === isbn13)));
          showSnackbar({ message: `Added ${title}`, action: { label: "View", onAction: () => router.push(`/library/${bookId}`) } });
          refocus();
        }}
      />
    </div>
  );
}

function LookupResult({
  state,
  readingLevelSystem,
  suggestions,
  onDone,
  onEnterDetails,
  onRetry,
}: {
  state: LookupState;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: Suggestions;
  onDone: (message: string, bookId?: string) => void;
  onEnterDetails: (isbn13: string) => void;
  onRetry: (isbn13: string) => void;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state.status === "idle" || state.status === "loading" ? state.status : `${state.status}-${state.isbn13}`}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8, transition: springs.fastEffects }}
        transition={springs.defaultSpatial}
      >
        {state.status === "idle" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-outline-variant px-6 py-12 text-center">
            <Icon icon={iconBarcodeScanner} size={40} className="text-on-surface-variant" />
            <p className="max-w-sm text-body-lg text-on-surface-variant">
              Look up a book by its ISBN. You&rsquo;ll see its cover and details before it&rsquo;s added.
            </p>
          </div>
        )}
        {state.status === "loading" && (
          <Section className="items-center py-12">
            <LoadingIndicator contained size={64} label="Looking up book" />
            <p className="text-body-lg text-on-surface-variant">Looking up {formatIsbn13(state.isbn13)}…</p>
          </Section>
        )}
        {state.status === "found" && (
          <FoundBook key={state.isbn13} state={state} readingLevelSystem={readingLevelSystem} suggestions={suggestions} onDone={onDone} />
        )}
        {state.status === "owned" && <OwnedBook state={state} onDone={onDone} />}
        {(state.status === "not_found" || state.status === "unavailable") && (
          <Section>
            <div className="flex items-start gap-3">
              <Icon icon={iconError} className="mt-0.5 text-error" />
              <div className="flex flex-col gap-1">
                <h2 className="text-title-lg-em">
                  {state.status === "not_found" ? "We couldn't find that book" : "Book lookup isn't responding"}
                </h2>
                <p className="text-body-md text-on-surface-variant">
                  {state.status === "not_found"
                    ? `No details were found for ISBN ${formatIsbn13(state.isbn13)}. You can enter them yourself.`
                    : "The book database didn't answer. Try again, or enter the details yourself."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={iconEdit} onPress={() => onEnterDetails(state.isbn13)}>
                Enter details
              </Button>
              {state.status === "unavailable" && (
                <Button variant="tonal" icon={iconRefresh} onPress={() => onRetry(state.isbn13)}>
                  Try again
                </Button>
              )}
            </div>
          </Section>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function FoundBook({
  state,
  readingLevelSystem,
  suggestions,
  onDone,
}: {
  state: Extract<LookupActionResult, { status: "found" }>;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: Suggestions;
  onDone: (message: string, bookId?: string) => void;
}) {
  const showSnackbar = useSnackbar();
  const [value, setValue] = useState(() => bookFormFromMetadata(state.metadata));
  const [copies, setCopies] = useState(1);
  const [pending, setPending] = useState(false);
  const { metadata } = state;
  const details = [metadata.publisher, metadata.publishedYear, metadata.pageCount && `${metadata.pageCount} pages`].filter(Boolean).join(" · ");

  return (
    <Section>
      <div className="flex gap-4">
        <div className="w-24 shrink-0 medium:w-32">
          <BookCover title={metadata.title} coverUrl={metadata.coverUrl} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label-md text-primary">Found</span>
          <h2 className="text-headline-sm-em">{metadata.title}</h2>
          {metadata.subtitle && <p className="text-body-lg text-on-surface-variant">{metadata.subtitle}</p>}
          {metadata.authors.length > 0 && <p className="text-title-md">{metadata.authors.join(", ")}</p>}
          {details && <p className="text-body-md text-on-surface-variant">{details}</p>}
          <p className="text-body-sm text-on-surface-variant tabular-nums">ISBN {formatIsbn13(metadata.isbn13)}</p>
        </div>
      </div>
      <ShelvingFields value={value} onChange={setValue} readingLevelSystem={readingLevelSystem} suggestions={suggestions} />
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <CopyCountStepper value={copies} onChange={setCopies} />
        <Button
          size="md"
          icon={iconLibraryAdd}
          isPending={pending}
          onPress={async () => {
            setPending(true);
            const result = await addBookAction(bookInputFromForm(value), copies);
            setPending(false);
            if (!result.ok) showSnackbar({ message: result.message });
            else onDone(`Added ${metadata.title}${copies > 1 ? ` (${copies} copies)` : ""}`, result.data.bookId);
          }}
        >
          Add to library
        </Button>
      </div>
    </Section>
  );
}

function OwnedBook({ state, onDone }: { state: Extract<LookupActionResult, { status: "owned" }>; onDone: (message: string, bookId?: string) => void }) {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);
  const { book } = state;
  return (
    <Section>
      <div className="flex gap-4">
        <div className="w-24 shrink-0">
          <BookCover title={book.title} coverUrl={book.coverUrl} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label-md text-tertiary">Already in your library</span>
          <h2 className="text-headline-sm-em">{book.title}</h2>
          {book.authors.length > 0 && <p className="text-title-md">{book.authors.join(", ")}</p>}
          <p className="text-body-md text-on-surface-variant">
            You have {book.totalCopies} {book.totalCopies === 1 ? "copy" : "copies"}.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={iconLibraryAdd}
          isPending={pending}
          onPress={async () => {
            setPending(true);
            const result = await addCopyAction(book.id);
            setPending(false);
            if (!result.ok) showSnackbar({ message: result.message });
            else onDone(`Added a copy of ${book.title}. You now have ${result.data.totalCopies}.`, book.id);
          }}
        >
          Add another copy
        </Button>
        <LinkButton variant="tonal" href={`/library/${book.id}`}>
          View book
        </LinkButton>
      </div>
    </Section>
  );
}

function RapidScanList({
  entries,
  addedCount,
  onUndo,
  onEnterDetails,
  onRetry,
}: {
  entries: ScanEntry[];
  addedCount: number;
  onUndo: (entry: ScanEntry) => void;
  onEnterDetails: (isbn13: string) => void;
  onRetry: (isbn13: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-outline-variant px-6 py-12 text-center">
        <Icon icon={iconBarcodeScanner} size={40} className="text-on-surface-variant" />
        <p className="max-w-sm text-body-lg text-on-surface-variant">
          Rapid scan is on. Each book you scan is added right away, and you can undo any of them here.
        </p>
      </div>
    );
  }

  return (
    <Section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-title-lg-em">This session</h2>
        <span className="text-label-lg text-primary">
          {addedCount} {addedCount === 1 ? "book" : "books"} added
        </span>
      </div>
      <ul className="flex flex-col gap-0.5" aria-live="polite">
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.li
              key={entry.key}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={springs.defaultSpatial}
              className="overflow-hidden rounded-xs bg-surface-container first:rounded-t-lg last:rounded-b-lg"
            >
              <div className={cx("flex min-h-18 items-center gap-3 px-3 py-2", entry.state === "undone" && "opacity-50")}>
                <div className="w-10 shrink-0">
                  {entry.state === "loading" ? (
                    <LoadingIndicator size={40} label="Looking up" />
                  ) : entry.result ? (
                    <BookCover title={entry.result.title} coverUrl={entry.result.coverUrl} size="sm" className="rounded-xs" />
                  ) : (
                    <Icon icon={iconError} className="mx-auto text-error" />
                  )}
                </div>
                <div className="flex min-w-0 grow flex-col">
                  <span className={cx("truncate text-body-lg", entry.state === "undone" && "line-through")}>
                    {entry.result?.title ?? formatIsbn13(entry.isbn13)}
                  </span>
                  <span className="truncate text-body-sm text-on-surface-variant">
                    {entry.state === "loading" && "Looking up…"}
                    {entry.state === "added" &&
                      (entry.result?.outcome === "created" ? "New title" : `Copy added · ${entry.result?.totalCopies} total`)}
                    {entry.state === "undone" && "Undone"}
                    {entry.state === "not_found" && "Not found. Add the details yourself."}
                    {entry.state === "unavailable" && "Lookup didn't respond"}
                    {entry.state === "error" && entry.message}
                  </span>
                </div>
                {entry.state === "added" && (
                  <IconButton icon={iconUndo} label={`Undo adding ${entry.result?.title}`} onPress={() => onUndo(entry)} />
                )}
                {entry.state === "added" && entry.result?.outcome === "created" && (
                  <Icon icon={iconCheckCircle} className="text-primary max-medium:hidden" filled />
                )}
                {entry.state === "not_found" && (
                  <Button variant="tonal" size="xs" onPress={() => onEnterDetails(entry.isbn13)}>
                    Add details
                  </Button>
                )}
                {entry.state === "unavailable" && (
                  <IconButton icon={iconRefresh} label="Try again" onPress={() => onRetry(entry.isbn13)} />
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Section>
  );
}

function ManualEntryDialog({
  value,
  onChange,
  readingLevelSystem,
  suggestions,
  onAdded,
}: {
  value: BookFormValue | null;
  onChange: (value: BookFormValue | null) => void;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: Suggestions;
  onAdded: (title: string, bookId: string, isbn13: string | null) => void;
}) {
  const [copies, setCopies] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formId = "manual-book-form";

  async function save() {
    if (!value) return;
    if (!value.title.trim()) {
      setError("Enter a title.");
      return;
    }
    setPending(true);
    const result = await addBookAction(bookInputFromForm(value), copies);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setCopies(1);
    onAdded(value.title.trim(), result.data.bookId, normalizeIsbn(value.isbn));
  }

  return (
    <Dialog
      isOpen={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          onChange(null);
          setError(null);
        }
      }}
      title="Add a book"
      fullScreenOnCompact
      actions={(close) => (
        <>
          <Button variant="text" onPress={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} isPending={pending}>
            Add book
          </Button>
        </>
      )}
    >
      {value && (
        <Form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4 pt-1 [--field-bg:var(--md-sys-color-surface-container-high)]"
        >
          {error && (
            <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}
          <BookFields value={value} onChange={onChange} readingLevelSystem={readingLevelSystem} suggestions={suggestions} />
          <CopyCountStepper value={copies} onChange={setCopies} />
        </Form>
      )}
    </Dialog>
  );
}
