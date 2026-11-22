"use client";

import { useEffect, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { formatSeriesNumber } from "@/lib/series";
import type { TidyPatch, TidySuggestion } from "@/lib/tidy";
import type { TidyProgress } from "@/server/tidy";
import type { TidyRunStatus } from "@/server/tidy-run";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconAutoStories, iconCheck } from "@/ui/icons/generated";
import { useTidyRun } from "../tidy-runner";
import { applyTidyAction, discardTidyAction, tidyReviewAction } from "./actions";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * What a "Fix everything" run left for the teacher: the doubtful suggestions, ticked or not,
 * once every book has been looked at. Also shows where a run has got to, and offers "Carry on"
 * when batches kept failing. Nothing changes until they apply, and nothing they set is replaced.
 */
export function SuggestionReview() {
  const showSnackbar = useSnackbar();
  const { status, progress, paused, resume, clear } = useTidyRun();
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [suggestions, setSuggestions] = useState<TidySuggestion[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const ready = status?.state === "ready";
  useEffect(() => {
    if (!ready) return;
    let current = true;
    void tidyReviewAction().then((result) => {
      if (!current) return;
      if (!result.ok) {
        showSnackbar({ message: result.message });
        return;
      }
      setSuggestions(result.data);
      setChosen(new Set(result.data.filter((suggestion) => suggestion.sure).map((suggestion) => suggestion.bookId)));
    });
    return () => {
      current = false;
    };
  }, [ready, showSnackbar]);

  async function apply() {
    setPending("apply");
    const result = await applyTidyAction([...chosen]);
    setPending(null);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    showSnackbar({ message: `Fixed ${plural(result.data.changed, "book")}.` });
    setSuggestions(null);
    clear();
  }

  async function discard() {
    setPending("discard");
    const result = await discardTidyAction();
    setPending(null);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    setSuggestions(null);
    clear();
  }

  const tick = (bookId: string, selected: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (selected) next.add(bookId);
      else next.delete(bookId);
      return next;
    });

  if (status === null) return null;

  if (status.state === "running") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body-sm text-on-surface-variant" aria-live="polite">
          {describeRun(status, progress, paused)}
        </p>
        <div className="flex flex-wrap gap-2">
          {paused && (
            <Button variant="tonal" icon={iconAutoStories} onPress={resume}>
              Carry on
            </Button>
          )}
          <Button variant="text" isPending={pending === "discard"} onPress={() => void discard()}>
            Stop and forget it
          </Button>
        </div>
      </div>
    );
  }

  if (suggestions === null) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        Loading what needs a look…
      </p>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body-sm text-on-surface-variant">{`Looked at ${plural(status.checked, "book")}: nothing more needs a look.`}</p>
        <Button variant="tonal" isPending={pending === "discard"} onPress={() => void discard()}>
          Done
        </Button>
      </div>
    );
  }

  const busy = pending !== null;
  return (
    <div className="flex w-full flex-col items-start gap-3">
      <p className="text-body-sm text-on-surface-variant">
        {`Looked at ${plural(status.checked, "book")}. ${plural(suggestions.length, "book")} need a look before anything is changed: the ones Gemini is sure of are ticked, the rest say why to check them first. Each change is checked again against the book as it is now when you apply it.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="text" size="xs" isDisabled={busy} onPress={() => setChosen(new Set(suggestions.map((suggestion) => suggestion.bookId)))}>
          Tick all
        </Button>
        <Button variant="text" size="xs" isDisabled={busy} onPress={() => setChosen(new Set())}>
          Untick all
        </Button>
      </div>
      <ul aria-label="Suggested fixes" className="flex w-full flex-col gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.bookId} className="flex gap-3 rounded-lg bg-surface-container-low p-3">
            <Checkbox
              aria-label={suggestion.title}
              isSelected={chosen.has(suggestion.bookId)}
              onChange={(selected) => tick(suggestion.bookId, selected)}
              className="self-start"
            />
            <div className="w-12 shrink-0">
              <BookCover title={suggestion.title} coverUrl={suggestion.patch.coverUrl ?? suggestion.coverUrl} size="sm" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-title-sm">{suggestion.title}</span>
              {!suggestion.sure && <span className="text-label-md text-on-surface-variant">Not certain. Check before applying.</span>}
              <ul className="flex flex-col gap-0.5 text-body-sm text-on-surface-variant">
                {describePatch(suggestion).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="filled" icon={iconCheck} isPending={pending === "apply"} isDisabled={busy || chosen.size === 0} onPress={() => void apply()}>
          {`Apply ${plural(chosen.size, "change")}`}
        </Button>
        <Button variant="text" isPending={pending === "discard"} isDisabled={busy} onPress={() => void discard()}>
          Discard all
        </Button>
      </div>
    </div>
  );
}

/** Where a run has got to, and what the batch being looked at is waiting on. */
function describeRun(status: TidyRunStatus, progress: TidyProgress | null, paused: string | null): string {
  const parts = [`Looked at ${status.checked} of ${plural(status.total, "book")} so far, with ${plural(status.found, "fix", "fixes")} to review${status.filled ? ` and ${plural(status.filled, "book")} fixed automatically` : ""}.`];
  if (paused) parts.push(`Paused: ${paused} Try again when you're ready.`);
  else if (progress && progress.answered > 0) parts.push(`Gemini has answered for ${progress.answered} of the next ${progress.total}…`);
  else if (status.error) parts.push("The last batch didn't finish; trying it again shortly.");
  else parts.push("You can leave this page: it keeps going while the app is open in any tab, and picks up where it stopped if you close it.");
  return parts.join(" ");
}

const GEMINI = " (from Gemini)";
const SEARCH = " (from a catalogue match by title and author)";

function describePatch({ patch, sources, title, authors }: TidySuggestion): string[] {
  const from = (field: keyof TidyPatch) => (sources[field] === "gemini" ? GEMINI : sources[field] === "search" ? SEARCH : "");
  const lines: string[] = [];
  if (patch.title) lines.push(`Title: ${title} → ${patch.title}`);
  if (patch.authors) lines.push(authors.length ? `Authors: ${authors.join(", ")} → ${patch.authors.join(", ")}` : `Authors: ${patch.authors.join(", ")}${from("authors")}`);
  if (patch.series) {
    const number = formatSeriesNumber(patch.series.number);
    lines.push(`Series: ${patch.series.name}${number ? `, book ${number}` : ""}`);
  }
  if (patch.genre) lines.push(`Genre${from("genre")}: ${patch.genre}`);
  if (patch.readingLevel) lines.push(`Reading level${from("readingLevel")}: ${patch.readingLevel}`);
  if (patch.tags) lines.push(`Tags${from("tags")}: ${patch.tags.join(", ")}`);
  if (patch.coverUrl) lines.push(`Cover${from("coverUrl")}: adds the one shown`);
  if (patch.subtitle) lines.push(`Subtitle${from("subtitle")}: ${patch.subtitle}`);
  if (patch.publisher) lines.push(`Publisher${from("publisher")}: ${patch.publisher}`);
  if (patch.publishedYear) lines.push(`Year published${from("publishedYear")}: ${patch.publishedYear}`);
  if (patch.pageCount) lines.push(`Pages${from("pageCount")}: ${patch.pageCount}`);
  if (patch.description) {
    const short = patch.description.length > 160 ? `${patch.description.slice(0, 157)}…` : patch.description;
    lines.push(`Description${from("description")}: ${short}`);
  }
  return lines;
}
