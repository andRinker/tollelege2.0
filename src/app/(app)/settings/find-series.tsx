"use client";

import { useState } from "react";
import type { FindSeriesResult } from "@/server/find-series";
import { Button } from "@/ui/components/button";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconLibraryBooks } from "@/ui/icons/generated";
import { findSeriesAction } from "./actions";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Finds series for books catalogued before series were read, a batch per press so the
 * teacher sees it working and no one request runs long. Nothing a teacher typed is replaced.
 */
export function FindSeries() {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; found: number; last: FindSeriesResult } | null>(null);

  async function run() {
    setPending(true);
    const result = await findSeriesAction(progress?.last.next ?? null);
    setPending(false);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    setProgress((current) => ({
      checked: (current?.checked ?? 0) + result.data.checked,
      found: (current?.found ?? 0) + result.data.found,
      last: result.data,
    }));
  }

  const done = progress !== null && progress.last.next === null;
  return (
    <div className="flex flex-col items-start gap-2">
      {!done && (
        <Button variant="tonal" icon={iconLibraryBooks} isPending={pending} onPress={() => void run()}>
          {progress ? `Check ${Math.min(progress.last.remaining, 25)} more` : "Find series for my library"}
        </Button>
      )}
      <p className="text-body-sm text-on-surface-variant" aria-live="polite">
        {progress === null
          ? "Looks up the series of books you added before series were recorded, 25 at a time. A series you've set is never changed."
          : progress.checked === 0
            ? "Every book with an ISBN already has a series, or none was found for it."
            : `Checked ${plural(progress.checked, "book")} and found a series for ${progress.found}.${
                done ? " That's every book." : ` ${plural(progress.last.remaining, "book")} still to check.`
              }`}
      </p>
    </div>
  );
}
