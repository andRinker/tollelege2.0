"use client";

import { useState } from "react";
import type { FindSeriesResult } from "@/server/find-series";
import { Button } from "@/ui/components/button";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconLibraryBooks, iconRefresh } from "@/ui/icons/generated";
import { findSeriesAction } from "./actions";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const BATCH = 25;

type Progress = {
  checked: number;
  found: number;
  /** Where the walk through the library goes next, or null once it has reached the end. */
  next: string | null;
  remaining: number;
  /** Books Open Library didn't answer for in time, to ask about again. */
  unanswered: string[];
};

/**
 * Finds series for books catalogued before series were read, a batch per press so the
 * teacher sees it working and no one request runs long. Nothing a teacher typed is replaced.
 *
 * Open Library is often too busy to answer a few books in a batch. Those aren't lost or
 * passed over in silence: they're counted, and once the walk is done they can be asked about
 * again on their own.
 */
export function FindSeries() {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const walking = progress === null || progress.next !== null;

  async function run() {
    const retry = walking ? undefined : progress?.unanswered.slice(0, BATCH);
    setPending(true);
    const result = await findSeriesAction(walking ? (progress?.next ?? null) : null, retry);
    setPending(false);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    setProgress((current) => absorb(current, result.data, retry));
  }

  const unanswered = progress?.unanswered.length ?? 0;
  const finished = progress !== null && !walking && unanswered === 0;

  return (
    <div className="flex flex-col items-start gap-2">
      {!finished && (
        <Button
          variant="tonal"
          icon={walking ? iconLibraryBooks : iconRefresh}
          isPending={pending}
          onPress={() => void run()}
        >
          {progress === null
            ? "Find series for my library"
            : walking
              ? `Check ${Math.min(progress.remaining, BATCH)} more`
              : `Ask about ${unanswered > BATCH ? `${BATCH} of those` : unanswered === 1 ? "that one" : `those ${unanswered}`} again`}
        </Button>
      )}
      <p className="text-body-sm text-on-surface-variant" aria-live="polite">
        {describe(progress, walking)}
      </p>
    </div>
  );
}

/** Folds one batch into the running totals. A retry swaps the books it asked about for any still unanswered. */
function absorb(current: Progress | null, batch: FindSeriesResult, retried: string[] | undefined): Progress {
  if (retried) {
    const asked = new Set(retried);
    return {
      ...current!,
      found: current!.found + batch.found,
      unanswered: [...current!.unanswered.filter((id) => !asked.has(id)), ...batch.unansweredIds],
    };
  }
  return {
    checked: (current?.checked ?? 0) + batch.checked,
    found: (current?.found ?? 0) + batch.found,
    next: batch.next,
    remaining: batch.remaining,
    unanswered: [...(current?.unanswered ?? []), ...batch.unansweredIds],
  };
}

function describe(progress: Progress | null, walking: boolean): string {
  if (progress === null) {
    return "Looks up the series of books you added before series were recorded, 25 at a time. A series you've set is never changed.";
  }
  if (progress.checked === 0) return "Every book with an ISBN already has a series, or none was found for it.";

  const parts = [`Checked ${plural(progress.checked, "book")} and found a series for ${progress.found}.`];
  const unanswered = progress.unanswered.length;
  if (walking) parts.push(`${plural(progress.remaining, "book")} still to check.`);
  if (unanswered > 0) {
    parts.push(
      `Open Library was too busy to answer for ${plural(unanswered, "book")}${walking ? "; you can ask about them again at the end" : ""}.`,
    );
  }
  if (!walking && unanswered === 0) {
    parts.push(
      "That's every book. Any still without a series aren't listed in one in Open Library's record of that printing; give them one from the book's Edit details.",
    );
  }
  return parts.join(" ");
}
