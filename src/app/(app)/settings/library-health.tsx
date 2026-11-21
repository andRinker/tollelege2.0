"use client";

import { useState } from "react";
import type { LibraryHealth } from "@/lib/health";
import { Button } from "@/ui/components/button";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconAutoStories } from "@/ui/icons/generated";
import { useTidyRun } from "../tidy-runner";
import { settleSpellingsAction } from "./actions";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * What is still missing or unsettled across the library, with the one button that works on all of
 * it: spellings settled, then every book looked at, with what Gemini is sure of applied without
 * asking, all under one Undo (the one beside "Settle series and author spellings"). The doubtful
 * are left for the Tidy review. Without Gemini it settles spellings and the catalogue facts wait.
 */
export function LibraryHealthCard({ health, tidyAvailable }: { health: LibraryHealth; tidyAvailable: boolean }) {
  const showSnackbar = useSnackbar();
  const { status, start } = useTidyRun();
  const [pending, setPending] = useState(false);
  if (health.books === 0) return null;

  const running = status?.state === "running";
  const { missing } = health;
  const needed: [string, number | null][] = [
    ["No author", missing.authors],
    ["No description", missing.description],
    ["No cover", missing.cover],
    ["No genre", missing.genre],
    ["Series spelled two ways", health.unsettledSeries],
    ["Author spelled two ways", health.unsettledAuthors],
  ];
  const optional: [string, number | null][] = [
    ["No tags", missing.tags],
    ["No reading level", missing.readingLevel],
    ["No page count", missing.pages],
    ["No publisher", missing.publisher],
    ["No year", missing.year],
    ["No ISBN", health.noIsbn],
  ];
  const nonZero = (rows: [string, number | null][]) => rows.filter((row): row is [string, number] => row[1] !== null && row[1] > 0);

  async function fix() {
    setPending(true);
    if (tidyAvailable) {
      const problem = await start(true);
      if (problem) showSnackbar({ message: problem });
    } else {
      const result = await settleSpellingsAction();
      showSnackbar({ message: result.ok ? (result.data.changed > 0 ? `Settled ${plural(result.data.changed, "book")}.` : "Spellings were already settled.") : result.message });
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-3" aria-label="Library health">
      <p className="text-title-sm">{`${health.completePercent}% of ${plural(health.books, "book")} sorted and named`}</p>
      <List title="Still needed" rows={nonZero(needed)} empty="Nothing needed: every book has an author, description, cover and genre, and every series and author is spelled one way." />
      <List title="Nice to have" rows={nonZero(optional)} empty="Nothing missing." />
      <div className="flex flex-col items-start gap-1">
        <Button variant="filled" icon={iconAutoStories} isPending={pending} isDisabled={pending || running} onPress={() => void fix()}>
          Fix everything
        </Button>
        <p className="text-body-sm text-on-surface-variant" aria-live="polite">
          {running
            ? `Working: ${status.checked} of ${plural(status.total, "book")} looked at, ${plural(status.filled, "book")} fixed so far. You can leave this page.`
            : tidyAvailable
              ? "Settles spellings, fills what the catalogues and Gemini know, and applies what Gemini is sure of. Anything doubtful waits for your review, and one Undo puts it all back."
              : "Settles spellings now. Filling the rest needs Gemini, which isn't set up here."}
        </p>
      </div>
    </div>
  );
}

function List({ title, rows, empty }: { title: string; rows: [string, number][]; empty: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-label-md text-on-surface-variant">{title}</p>
      {rows.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">{empty}</p>
      ) : (
        <ul className="grid gap-x-6 text-body-sm text-on-surface-variant medium:grid-cols-2">
          {rows.map(([label, count]) => (
            <li key={label}>{`${label}: ${count}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
