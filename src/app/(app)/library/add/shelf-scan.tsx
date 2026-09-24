"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { preparePhoto } from "@/components/prepare-photo";
import { ShelfCropper } from "@/components/shelf-cropper";
import type { CropBox } from "@/lib/crop";
import { describeGap } from "@/lib/shelf-gaps";
import type { MatchCandidate, ShelfScan, ShelfSlot, ShelfTally } from "@/server/shelf-scan";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { Icon } from "@/ui/components/icon";
import { LoadingIndicator } from "@/ui/components/loading-indicator";
import { Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { Checkbox } from "@/ui/components/selection-controls";
import { ShelfCountField } from "@/components/shelf-count-field";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import {
  iconBarcodeScanner,
  iconCheckCircle,
  iconEdit,
  iconError,
  iconHelp,
  iconLibraryAdd,
  iconPhotoCamera,
  iconRefresh,
} from "@/ui/icons/generated";
import { addCopyAction, quickAddAction, scanShelfAction } from "../actions";

type Row = {
  slot: ShelfSlot;
  /** Which of the candidate editions the teacher has picked. */
  chosen: number;
  selected: boolean;
};

type State =
  | { kind: "idle" }
  /** A photo picked, waiting to be cropped to one shelf (or sent whole). */
  | { kind: "cropping"; file: File; count: string }
  | { kind: "reading" }
  | { kind: "review"; rows: Row[]; tally: ShelfTally; otherShelf: number }
  | { kind: "adding"; done: number; total: number }
  | { kind: "error"; message: string };

/** What ended up filling a gap, as the row should say it. Display only. */
export type GapFill = { title: string; note: string };

/** A row the scan couldn't finish: no book on it, only a place on the shelf. */
function isGap(row: Row): boolean {
  return row.slot.proposal === null;
}

const CONFIDENCE_LABEL: Record<MatchCandidate["confidence"], { text: string; className: string }> = {
  exact: { text: "Match", className: "text-primary" },
  close: { text: "Check this one", className: "text-tertiary" },
  weak: { text: "Probably wrong", className: "text-error" },
};

/**
 * Turns what the reader saw into what the teacher is asked about. Shared by a photo
 * picked here and one sent from a paired phone, so a shelf is reviewed the same way
 * whichever camera took it.
 *
 * Every slot becomes a row, including the ones with no book on them. They stay in shelf
 * order so the list reads like the shelf: the row for a spine nobody could read sits
 * physically between its neighbours, which is most of the explanation it needs.
 */
function reviewFrom(scan: Pick<ShelfScan, "slots"> & Partial<Pick<ShelfScan, "tally" | "otherShelf">>): State {
  // A shelf a phone sent before copies and counts existed has neither; read it as one copy
  // a spine, with no count to check against.
  const slots = scan.slots.map((slot) => ({ ...slot, copies: slot.copies ?? 1, secondLook: slot.secondLook ?? false }));
  const seen = slots.reduce((total, slot) => total + slot.copies, 0);
  return {
    kind: "review",
    tally: scan.tally ?? { expected: null, seen, missing: 0, foundOnSecondLook: 0 },
    otherShelf: scan.otherShelf ?? 0,
    rows: slots.map((slot) => ({
      slot,
      chosen: 0,
      // Four kinds of row start unticked: a doubtful match, so nothing wrong is added by
      // simply not looking; a book already on the shelves, since re-photographing a
      // catalogued shelf should not silently multiply its copies; a book only a second
      // look found, since a count is exactly what could talk the reader into one; and a
      // gap, which has nothing to tick in the first place.
      selected:
        slot.proposal !== null &&
        slot.proposal.candidates[0].confidence !== "weak" &&
        !slot.proposal.owned &&
        !slot.secondLook,
    })),
  };
}

/** Books the selected rows stand for, counting every copy of a folded row. */
function selectedBooks(rows: Row[]): number {
  return rows.reduce((total, row) => total + (row.selected ? row.slot.copies : 0), 0);
}

type ShelfScanDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Slots that arrived from a paired phone, to review instead of taking a photo here.
   * The caller remounts on each new shelf, so this is only ever read once.
   */
  incoming?: Pick<ShelfScan, "slots"> & Partial<Pick<ShelfScan, "tally" | "otherShelf">>;
  /** The gap waiting for the next scan, if any. Owned above, since scans arrive there. */
  armedPosition: number | null;
  onArm: (position: number | null) => void;
  /** What has since been added into a gap, by position. */
  gapResults: Record<number, GapFill>;
  onFillGap: (position: number, isbn13: string) => Promise<string | null>;
  onAddByHand: (position: number, title: string) => void;
};

export function ShelfScanDialog({
  isOpen,
  onOpenChange,
  incoming,
  armedPosition,
  onArm,
  gapResults,
  onFillGap,
  onAddByHand,
}: ShelfScanDialogProps) {
  const [state, setState] = useState<State>(() => (incoming ? reviewFrom(incoming) : { kind: "idle" }));
  const showSnackbar = useSnackbar();

  function reset() {
    setState({ kind: "idle" });
  }

  async function scan(file: File, count: string, crop: CropBox | null) {
    setState({ kind: "reading" });
    const data = new FormData();
    data.set("photo", await preparePhoto(file, crop));
    if (count.trim()) data.set("expected", count.trim());
    const result = await scanShelfAction(data);

    if (result.status === "unconfigured") {
      setState({ kind: "error", message: "Shelf photos aren't set up on this site yet." });
      return;
    }
    if (result.status !== "scanned") {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState(reviewFrom(result));
  }

  async function addSelected(rows: Row[], close: () => void) {
    const chosen = rows.filter((row) => row.selected && row.slot.proposal);
    const total = selectedBooks(chosen);
    setState({ kind: "adding", done: 0, total });

    let added = 0;
    let copied = 0;
    let failed = 0;
    let done = 0;
    for (const row of chosen) {
      const proposal = row.slot.proposal as NonNullable<ShelfSlot["proposal"]>;
      // One row can stand for several identical spines; each is a copy on the shelf.
      for (let copy = 0; copy < row.slot.copies; copy++) {
        if (proposal.owned) {
          // Already catalogued, so this is another physical copy of a book that exists.
          const result = await addCopyAction(proposal.owned.bookId);
          if (result.ok) copied += 1;
          else failed += 1;
        } else {
          // The first adds the book; any more are further copies of it, which is what the
          // ordinary scan path does with an ISBN the library already has.
          const result = await quickAddAction(proposal.candidates[row.chosen].isbn13);
          if (result.status !== "added") failed += 1;
          else if (result.result.outcome === "copy_added") copied += 1;
          else added += 1;
        }
        done += 1;
        setState({ kind: "adding", done, total });
      }
    }

    close();
    reset();
    const parts = [
      added > 0 && `${added} ${added === 1 ? "book" : "books"}`,
      copied > 0 && `${copied} ${copied === 1 ? "copy" : "copies"}`,
    ].filter(Boolean);
    showSnackbar({
      message:
        failed === 0
          ? `Added ${parts.join(" and ")} from the shelf.`
          : `Added ${parts.join(" and ") || "nothing"}, but ${failed} couldn't be added.`,
    });
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) reset();
      }}
      title="Photograph a shelf"
      fullScreenOnCompact
      isDismissable={state.kind !== "adding"}
      className="max-w-[640px]"
      actions={(close) =>
        state.kind === "review" ? (
          <>
            <Button variant="text" onPress={reset}>
              Retake
            </Button>
            <Button
              icon={iconLibraryAdd}
              isDisabled={!state.rows.some((row) => row.selected)}
              onPress={() => void addSelected(state.rows, close)}
            >
              {`Add ${selectedBooks(state.rows)}`}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-col gap-4">
        {state.kind === "idle" && <PhotoPicker onPick={(file, count) => setState({ kind: "cropping", file, count })} />}

        {state.kind === "cropping" && (
          <ShelfCropper file={state.file} onUse={(crop) => void scan(state.file, state.count, crop)} />
        )}

        {state.kind === "reading" && (
          <div className="grid place-items-center gap-3 py-12">
            <LoadingIndicator contained label="Reading the shelf" />
            <p className="text-body-md text-on-surface-variant">Reading the spines…</p>
          </div>
        )}

        {state.kind === "adding" && (
          <div className="grid place-items-center gap-3 py-12">
            <LoadingIndicator contained label="Adding books" />
            <p className="text-body-md text-on-surface-variant">{`Adding ${state.done} of ${state.total}…`}</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Icon icon={iconError} size={40} className="text-error" />
            <p className="text-body-lg">{state.message}</p>
            <Button variant="tonal" icon={iconRefresh} onPress={reset}>
              Try again
            </Button>
          </div>
        )}

        {state.kind === "review" && (
          <ReviewList
            rows={state.rows}
            tally={state.tally}
            otherShelf={state.otherShelf}
            onChange={(rows) => setState({ ...state, rows })}
            armedPosition={armedPosition}
            onArm={onArm}
            gapResults={gapResults}
            onFillGap={onFillGap}
            onAddByHand={onAddByHand}
          />
        )}
      </div>
    </Dialog>
  );
}

function PhotoPicker({ onPick }: { onPick: (file: File, count: string) => void }) {
  const [count, setCount] = useState("");
  return (
    <div className="flex flex-col gap-4 py-2 [--field-bg:var(--md-sys-color-surface-container-high)]">
      <p className="text-body-md text-on-surface-variant">
        Take one photo of a single shelf, straight on, with the spines readable. Every book it finds is a suggestion
        you confirm — nothing is added until you say so.
      </p>
      <ShelfCountField value={count} onChange={setCount} />
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-6 py-4 text-label-lg text-on-primary">
        <Icon icon={iconPhotoCamera} size={20} />
        Take a photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(file, count);
            event.target.value = "";
          }}
        />
      </label>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-secondary-container px-6 py-4 text-label-lg text-on-secondary-container">
        Choose an existing photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(file, count);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

/** What the photo showed, measured against the teacher's count when there is one. */
function describeTally(tally: ShelfTally): string | null {
  const { expected, seen, foundOnSecondLook } = tally;
  if (expected === null) return null;
  const again = foundOnSecondLook > 0 ? ` A second look found ${foundOnSecondLook} of them.` : "";
  if (seen === expected) return `Found all ${expected} books you counted.${again}`;
  if (seen < expected) return `Found ${seen} of the ${expected} books you counted.${again}`;
  const extra = seen - expected;
  return `Found ${seen}; you counted ${expected}, so ${extra === 1 ? "one may have been" : `${extra} may have been`} read twice.${again}`;
}

function ReviewList({
  rows,
  tally,
  otherShelf,
  onChange,
  armedPosition,
  onArm,
  gapResults,
  onFillGap,
  onAddByHand,
}: {
  rows: Row[];
  tally: ShelfTally;
  otherShelf: number;
  onChange: (rows: Row[]) => void;
  armedPosition: number | null;
  onArm: (position: number | null) => void;
  gapResults: Record<number, GapFill>;
  onFillGap: (position: number, isbn13: string) => Promise<string | null>;
  onAddByHand: (position: number, title: string) => void;
}) {
  const [typingAt, setTypingAt] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [gapError, setGapError] = useState<{ position: number; message: string } | null>(null);

  function update(index: number, changes: Partial<Row>) {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...changes } : row)));
  }

  // What is legible on the shelf, so a gap can be described by its neighbours. A spine
  // that was read but matched nothing still anchors: the teacher can see that title even
  // though no catalogue could. Only a spine nobody could read at all is a blank here.
  // A gap already filled in counts as known too, so the list tightens up as it is worked
  // down: fill the first of three and the remaining two stop calling themselves 2nd and 3rd.
  const titles = rows.map((row) =>
    row.slot.proposal
      ? (row.slot.proposal.owned?.title ?? row.slot.proposal.candidates[0].title)
      : (gapResults[row.slot.position]?.title ?? row.slot.reading?.title ?? null),
  );

  const books = rows.filter((row) => !isGap(row)).length;
  // Books the teacher counted that the photo showed no trace of. They have no place on the
  // shelf to be described by, so they follow the shelf's own rows, numbered after them.
  const missing = Array.from({ length: tally.missing }, (_, index) => rows.length + index);
  const outstanding =
    rows.filter((row) => isGap(row) && !gapResults[row.slot.position]).length +
    missing.filter((position) => !gapResults[position]).length;
  const tallyText = describeTally(tally);

  /** A row with no book on it yet, from the shelf or from the count: the same three ways to fill it. */
  function gapRow({
    position,
    title,
    note,
    detail,
    handTitle,
  }: {
    position: number;
    title: string;
    note: string;
    detail: string | null;
    handTitle: string;
  }) {
    const filled = gapResults[position];
    return (
          <li
            key={`gap-${position}`}
            className={cx(
              "flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2",
              filled ? "border-transparent bg-surface-container" : "border-outline-variant",
            )}
          >
            <div className="flex items-center gap-3">
              <Icon
                icon={filled ? iconCheckCircle : iconHelp}
                size={20}
                className={filled ? "text-primary" : "text-on-surface-variant"}
              />
              <div className="min-w-0 grow">
                <p className="truncate text-body-lg">
                  {filled ? filled.title : title}
                </p>
                <p className="truncate text-body-sm text-on-surface-variant">
                  {filled ? filled.note : note}
                </p>
                {!filled && detail && <p className="truncate text-label-sm text-on-surface-variant">{detail}</p>}
              </div>
            </div>

            {!filled &&
              (armedPosition === position ? (
                <div className="flex items-center gap-2 pl-8">
                  <span className="flex items-center gap-2 text-body-sm text-primary">
                    <Icon icon={iconBarcodeScanner} size={18} />
                    Scan this one now, with your phone or a barcode scanner.
                  </span>
                  <Button variant="text" size="xs" onPress={() => onArm(null)}>
                    Cancel
                  </Button>
                </div>
              ) : typingAt === position ? (
                <form
                  className="flex items-end gap-2 pl-8"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const message = await onFillGap(position, typed);
                    if (message) {
                      setGapError({ position, message });
                      return;
                    }
                    setGapError(null);
                    setTypingAt(null);
                    setTyped("");
                  }}
                >
                  <TextField
                    label="ISBN"
                    value={typed}
                    onChange={(value) => setTyped(value)}
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    className="grow"
                    inputClassName="tabular-nums"
                    isInvalid={gapError?.position === position}
                    errorMessage={gapError?.position === position ? gapError.message : undefined}
                  />
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                  <Button variant="text" size="sm" onPress={() => setTypingAt(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-1 pl-8">
                  <Button variant="tonal" size="xs" icon={iconBarcodeScanner} onPress={() => onArm(position)}>
                    Scan it
                  </Button>
                  <Button
                    variant="text"
                    size="xs"
                    onPress={() => {
                      setTypingAt(position);
                      setTyped("");
                      setGapError(null);
                    }}
                  >
                    Type ISBN
                  </Button>
                  <Button
                    variant="text"
                    size="xs"
                    icon={iconEdit}
                    onPress={() => onAddByHand(position, handTitle)}
                  >
                    By hand
                  </Button>
                </div>
              ))}
          </li>
    );
  }

  if (rows.length === 0 && missing.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon icon={iconError} size={40} className="text-on-surface-variant" />
        <p className="text-body-lg">No books could be read from that photo.</p>
        <p className="text-body-md text-on-surface-variant">
          Try one shelf at a time, square on, with enough light to read the spines yourself.
        </p>
      </div>
    );
  }

  return (
    // An armed gap is a standing instruction that the next barcode belongs here, so the
    // review opts into the wedge that dialogs otherwise swallow. See `use-barcode-wedge`.
    <div
      className="flex min-h-0 flex-col gap-3 overflow-y-auto"
      data-barcode-wedge={armedPosition !== null ? "" : undefined}
    >
      <p className="text-body-md text-on-surface-variant">
        {tallyText ? `${tallyText} ` : `Found ${books} ${books === 1 ? "book" : "books"}. `}
        {outstanding > 0 ? (
          <span className="text-on-surface">
            {`${outstanding} ${outstanding === 1 ? "spine needs" : "spines need"} you.`}
          </span>
        ) : (
          "Untick anything that looks wrong."
        )}
      </p>

      {otherShelf > 0 && (
        <p className="text-body-sm text-on-surface-variant">
          {`Left out ${otherShelf} ${otherShelf === 1 ? "spine" : "spines"} from another shelf in the photo. If that was the shelf you meant, retake it and crop to just that one.`}
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {rows.map((row, index) => {
          const position = row.slot.position;

          if (isGap(row)) {
            const readTitle = row.slot.reading?.title ?? null;
            return gapRow({
              position,
              title: readTitle ?? "Couldn't read this spine",
              note: describeGap(titles, index),
              detail: readTitle ? "No catalogue had this one" : row.slot.fragment ? `Could make out: ${row.slot.fragment}` : null,
              handTitle: readTitle ?? "",
            });
          }

          const proposal = row.slot.proposal as NonNullable<ShelfSlot["proposal"]>;
          const candidate = proposal.candidates[row.chosen];
          const owned = proposal.owned;
          const label = owned
            ? {
                text:
                  owned.copies === 1
                    ? "Already on your shelves — ticking adds a second copy"
                    : `Already on your shelves (${owned.copies} copies) — ticking adds another`,
                className: "text-on-surface-variant",
              }
            : CONFIDENCE_LABEL[candidate.confidence];
          return (
            <li key={`book-${position}`} className="flex items-center gap-3 rounded-lg px-1 py-2">
              <Checkbox
                isSelected={row.selected}
                onChange={(selected) => update(index, { selected })}
                aria-label={`Add ${candidate.title}`}
              />
              {/* BookCover sizes itself to its container, so the width goes on a wrapper. */}
              <div className="w-10 shrink-0">
                <BookCover title={candidate.title} coverUrl={candidate.coverUrl} size="sm" />
              </div>
              <div className="min-w-0 grow">
                <p className="truncate text-body-lg">{owned ? owned.title : candidate.title}</p>
                <p className="truncate text-body-sm text-on-surface-variant">
                  {candidate.authors.join(", ") || row.slot.reading?.author || "Unknown author"}
                </p>
                <p className={cx("text-label-sm", label.className)}>{label.text}</p>
                {row.slot.copies > 1 && (
                  <p className="text-label-sm text-on-surface-variant">{`${row.slot.copies} copies on the shelf — ticking adds ${row.slot.copies}`}</p>
                )}
                {row.slot.secondLook && (
                  <p className="text-label-sm text-tertiary">Found on a second look — check it&rsquo;s really there</p>
                )}
              </div>
              {!owned && proposal.candidates.length > 1 && (
                <MenuTrigger>
                  <Button variant="text" size="xs">
                    Edition
                  </Button>
                  <Menu
                    selectionMode="single"
                    selectedKeys={[String(row.chosen)]}
                    onSelectionChange={(keys) => {
                      const next = Number([...keys][0]);
                      if (!Number.isNaN(next)) update(index, { chosen: next });
                    }}
                  >
                    {proposal.candidates.map((option, optionIndex) => (
                      <MenuItem key={option.isbn13} id={String(optionIndex)}>
                        {`${option.title} — ${option.authors[0] ?? "Unknown"}`}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              )}
            </li>
          );
        })}
        {missing.map((position) =>
          gapRow({
            position,
            title: "Not found in the photo",
            note: "Somewhere on this shelf; the photo showed no sign of it",
            detail: null,
            handTitle: "",
          }),
        )}
      </ul>
    </div>
  );
}
