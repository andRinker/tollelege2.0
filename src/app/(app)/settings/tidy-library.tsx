"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import type { ActionResult } from "@/lib/action-result";
import { postWithProgress, useSingleFlight } from "@/lib/gemini-requests";
import { formatSeriesNumber } from "@/lib/series";
import type { TidyPatch, TidySuggestion } from "@/lib/tidy";
import type { TidyBatch, TidyProgress } from "@/server/tidy";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconAutoStories, iconCheck } from "@/ui/icons/generated";
import { applyTidyAction } from "./actions";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

type Walk = { checked: number; changed: number; next: string | null; remaining: number };

/**
 * "Tidy my library": a batch of books at a time, the catalogues and Gemini suggest missing
 * series, tidier titles and author names, covers and blank details, and the teacher ticks
 * which to apply. Nothing changes until they do, and nothing they set is replaced.
 */
export function TidyLibrary() {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState<"look" | "apply" | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [suggestions, setSuggestions] = useState<TidySuggestion[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<TidyProgress | null>(null);
  // One batch at a time: each is a Gemini request, and a repeat press would be another.
  const singleFlight = useSingleFlight("tidy");

  function look(after: string | null) {
    return singleFlight(async () => {
      setPending("look");
      setProgress(null);
      let result: ActionResult<TidyBatch>;
      try {
        result = await postWithProgress<TidyProgress, ActionResult<TidyBatch>>("tidy", "/api/tidy", { after }, { after }, setProgress);
      } catch {
        result = { ok: false, message: "The connection dropped while checking those books. Try again." };
      }
      setPending(null);
      setProgress(null);
      show(result);
    });
  }

  function show(result: ActionResult<TidyBatch>) {
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    absorb(result.data);
  }

  function absorb(batch: TidyBatch) {
    setWalk((current) => ({
      checked: (current?.checked ?? 0) + batch.checked,
      changed: current?.changed ?? 0,
      next: batch.next,
      remaining: batch.remaining,
    }));
    setSuggestions(batch.suggestions);
    setChosen(new Set(batch.suggestions.filter((suggestion) => suggestion.sure).map((suggestion) => suggestion.bookId)));
  }

  async function apply() {
    const changes = suggestions
      .filter((suggestion) => chosen.has(suggestion.bookId))
      .map(({ bookId, patch }) => ({ bookId, patch }));
    setPending("apply");
    const result = await applyTidyAction(changes);
    setPending(null);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    showSnackbar({ message: `Tidied ${plural(result.data.changed, "book")}.` });
    setWalk((current) => current && { ...current, changed: current.changed + result.data.changed });
    setSuggestions([]);
    if (walk?.next) await look(walk.next);
  }

  function skip() {
    setSuggestions([]);
    if (walk?.next) void look(walk.next);
  }

  const finished = walk !== null && walk.next === null && suggestions.length === 0;

  return (
    <div className="flex flex-col items-start gap-3">
      {suggestions.length > 0 ? (
        <>
          <ul aria-label="Suggested fixes" className="flex w-full flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.bookId} className="flex gap-3 rounded-lg bg-surface-container-low p-3">
                <Checkbox
                  aria-label={suggestion.title}
                  isSelected={chosen.has(suggestion.bookId)}
                  onChange={(selected) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (selected) next.add(suggestion.bookId);
                      else next.delete(suggestion.bookId);
                      return next;
                    })
                  }
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
            <Button variant="filled" icon={iconCheck} isPending={pending !== null} isDisabled={chosen.size === 0} onPress={() => void apply()}>
              {`Apply ${plural(chosen.size, "change")}`}
            </Button>
            <Button variant="text" isDisabled={pending !== null} onPress={skip}>
              {walk?.next ? "Skip these" : "Skip"}
            </Button>
          </div>
        </>
      ) : (
        !finished && (
          <Button variant="tonal" icon={iconAutoStories} isPending={pending !== null} onPress={() => void look(walk?.next ?? null)}>
            {walk === null ? "Tidy my library" : `Check ${Math.min(walk.remaining, 10)} more`}
          </Button>
        )
      )}
      <p className="text-body-sm text-on-surface-variant" aria-live="polite">
        {pending === "look" ? describeProgress(progress) : describeWalk(walk, suggestions.length)}
      </p>
    </div>
  );
}

/** Where a batch has got to, as Gemini's answer streams in. */
function describeProgress(progress: TidyProgress | null): string {
  if (progress === null || progress.answered === 0) return "Checking the catalogues and asking Gemini about these books…";
  return `Gemini has answered for ${progress.answered} of ${plural(progress.total, "book")}…`;
}

function describeWalk(walk: Walk | null, shown: number): string {
  if (walk === null) {
    return "Looks through your books 10 at a time and suggests fixes: missing series, tidier titles and author names, covers, and blank details. Titles, authors and series are sent to Google Gemini. You choose what to apply, and nothing you've set is replaced.";
  }
  const parts = [`Looked at ${plural(walk.checked, "book")} and tidied ${walk.changed}.`];
  if (shown > 0) parts.push(`${plural(shown, "book")} in this batch could be tidied; the ones ticked are the sure ones.`);
  else if (walk.next !== null) parts.push("Nothing to fix in that batch.");
  if (walk.next !== null) parts.push(`${plural(walk.remaining, "book")} still to look at.`);
  else if (shown === 0) parts.push("That's every book.");
  return parts.join(" ");
}

const GEMINI = " (from Gemini)";

function describePatch({ patch, sources, title, authors }: TidySuggestion): string[] {
  const from = (field: keyof TidyPatch) => (sources[field] === "gemini" ? GEMINI : "");
  const lines: string[] = [];
  if (patch.title) lines.push(`Title: ${title} → ${patch.title}`);
  if (patch.authors) lines.push(authors.length ? `Authors: ${authors.join(", ")} → ${patch.authors.join(", ")}` : `Authors: ${patch.authors.join(", ")}${from("authors")}`);
  if (patch.series) {
    const number = formatSeriesNumber(patch.series.number);
    lines.push(`Series: ${patch.series.name}${number ? `, book ${number}` : ""}`);
  }
  if (patch.coverUrl) lines.push("Cover: adds the one shown");
  if (patch.subtitle) lines.push(`Subtitle: ${patch.subtitle}`);
  if (patch.publisher) lines.push(`Publisher: ${patch.publisher}`);
  if (patch.publishedYear) lines.push(`Year published: ${patch.publishedYear}`);
  if (patch.pageCount) lines.push(`Pages: ${patch.pageCount}`);
  if (patch.description) {
    const short = patch.description.length > 160 ? `${patch.description.slice(0, 157)}…` : patch.description;
    lines.push(`Description${from("description")}: ${short}`);
  }
  return lines;
}
