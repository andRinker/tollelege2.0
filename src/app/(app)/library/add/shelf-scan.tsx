"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { preparePhoto } from "@/components/prepare-photo";
import type { MatchCandidate, ShelfProposal } from "@/server/shelf-scan";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { Icon } from "@/ui/components/icon";
import { LoadingIndicator } from "@/ui/components/loading-indicator";
import { Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { Checkbox } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import {
  iconBarcodeScanner,
  iconError,
  iconLibraryAdd,
  iconPhotoCamera,
  iconRefresh,
} from "@/ui/icons/generated";
import { addCopyAction, quickAddAction, scanShelfAction } from "../actions";

type Row = {
  proposal: ShelfProposal;
  /** Which of the candidate editions the teacher has picked. */
  chosen: number;
  selected: boolean;
};

type State =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "review"; rows: Row[]; unreadable: string[] }
  | { kind: "adding"; done: number; total: number }
  | { kind: "error"; message: string };

const CONFIDENCE_LABEL: Record<MatchCandidate["confidence"], { text: string; className: string }> = {
  exact: { text: "Match", className: "text-primary" },
  close: { text: "Check this one", className: "text-tertiary" },
  weak: { text: "Probably wrong", className: "text-error" },
};

/**
 * Turns what the reader saw into what the teacher is asked about. Shared by a photo
 * picked here and one sent from a paired phone, so a shelf is reviewed the same way
 * whichever camera took it.
 */
function reviewFrom(proposals: ShelfProposal[]): State {
  const rows: Row[] = proposals
    .filter((proposal) => proposal.candidates.length > 0)
    .map((proposal) => ({
      proposal,
      chosen: 0,
      // Two kinds of row start unticked: a doubtful match, so nothing wrong is added by
      // simply not looking, and a book already on the shelves, since re-photographing a
      // catalogued shelf should not silently multiply its copies.
      selected: proposal.candidates[0].confidence !== "weak" && !proposal.owned,
    }));
  const unreadable = proposals
    .filter((proposal) => proposal.candidates.length === 0)
    .map((proposal) => proposal.reading.title);
  return { kind: "review", rows, unreadable };
}

type ShelfScanDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Proposals that arrived from a paired phone, to review instead of taking a photo here.
   * The caller remounts on each new shelf, so this is only ever read once.
   */
  incoming?: ShelfProposal[] | null;
};

export function ShelfScanDialog({ isOpen, onOpenChange, incoming }: ShelfScanDialogProps) {
  const [state, setState] = useState<State>(() => (incoming ? reviewFrom(incoming) : { kind: "idle" }));
  const showSnackbar = useSnackbar();

  function reset() {
    setState({ kind: "idle" });
  }

  async function scan(file: File) {
    setState({ kind: "reading" });
    const data = new FormData();
    data.set("photo", await preparePhoto(file));
    const result = await scanShelfAction(data);

    if (result.status === "unconfigured") {
      setState({ kind: "error", message: "Shelf photos aren't set up on this site yet." });
      return;
    }
    if (result.status !== "scanned") {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState(reviewFrom(result.proposals));
  }

  async function addSelected(rows: Row[], close: () => void) {
    const chosen = rows.filter((row) => row.selected);
    setState({ kind: "adding", done: 0, total: chosen.length });

    let added = 0;
    let copied = 0;
    let failed = 0;
    for (const [index, row] of chosen.entries()) {
      if (row.proposal.owned) {
        // Already catalogued, so this is another physical copy of a book that exists.
        const result = await addCopyAction(row.proposal.owned.bookId);
        if (result.ok) copied += 1;
        else failed += 1;
      } else {
        const result = await quickAddAction(row.proposal.candidates[row.chosen].isbn13);
        if (result.status === "added") added += 1;
        else failed += 1;
      }
      setState({ kind: "adding", done: index + 1, total: chosen.length });
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
              {`Add ${state.rows.filter((row) => row.selected).length}`}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-col gap-4">
        {state.kind === "idle" && <PhotoPicker onPick={(file) => void scan(file)} />}

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
            unreadable={state.unreadable}
            onChange={(rows) => setState({ ...state, rows })}
          />
        )}
      </div>
    </Dialog>
  );
}

function PhotoPicker({ onPick }: { onPick: (file: File) => void }) {
  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-body-md text-on-surface-variant">
        Take one photo of a single shelf, straight on, with the spines readable. Every book it finds is a suggestion
        you confirm — nothing is added until you say so.
      </p>
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
            if (file) onPick(file);
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
            if (file) onPick(file);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

function ReviewList({
  rows,
  unreadable,
  onChange,
}: {
  rows: Row[];
  unreadable: string[];
  onChange: (rows: Row[]) => void;
}) {
  function update(index: number, changes: Partial<Row>) {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...changes } : row)));
  }

  if (rows.length === 0) {
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
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <p className="text-body-md text-on-surface-variant">
        {`Found ${rows.length} ${rows.length === 1 ? "book" : "books"}. Untick anything that looks wrong.`}
      </p>

      <ul className="flex flex-col gap-1">
        {rows.map((row, index) => {
          const candidate = row.proposal.candidates[row.chosen];
          const owned = row.proposal.owned;
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
            <li key={`${row.proposal.reading.title}-${index}`} className="flex items-center gap-3 rounded-lg px-1 py-2">
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
                  {candidate.authors.join(", ") || row.proposal.reading.author || "Unknown author"}
                </p>
                <p className={cx("text-label-sm", label.className)}>{label.text}</p>
              </div>
              {!owned && row.proposal.candidates.length > 1 && (
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
                    {row.proposal.candidates.map((option, position) => (
                      <MenuItem key={option.isbn13} id={String(position)}>
                        {`${option.title} — ${option.authors[0] ?? "Unknown"}`}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              )}
            </li>
          );
        })}
      </ul>

      {unreadable.length > 0 && (
        <div className="rounded-lg bg-surface-container px-4 py-3">
          <p className="flex items-center gap-2 text-body-md">
            <Icon icon={iconBarcodeScanner} size={18} />
            {`${unreadable.length} ${unreadable.length === 1 ? "spine" : "spines"} couldn't be matched — scan ${unreadable.length === 1 ? "it" : "them"} by barcode:`}
          </p>
          <ul className="mt-1 list-disc pl-8 text-body-sm text-on-surface-variant">
            {unreadable.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
