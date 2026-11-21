"use client";

import { useState } from "react";
import { Button } from "@/ui/components/button";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconSort, iconUndo } from "@/ui/icons/generated";
import { settleSpellingsAction, undoSettleAction } from "./actions";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Gives each series and each author one spelling across the library. It changes only spellings
 * that name the same series or the same person, so it applies at once, and the last pass can be
 * undone here. New books are settled as they're added, so this is for what was saved before.
 */
export function SettleSpellings({ last }: { last: { batchId: string; books: number } | null }) {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState<"settle" | "undo" | null>(null);
  const [batch, setBatch] = useState(last);
  const [note, setNote] = useState<string | null>(null);

  async function settle() {
    setPending("settle");
    const result = await settleSpellingsAction();
    setPending(null);
    if (!result.ok) return showSnackbar({ message: result.message });
    const { batchId, changed } = result.data;
    setBatch(batchId ? { batchId, books: changed } : null);
    setNote(changed > 0 ? `Settled ${plural(changed, "book")}.` : "Every series and author is already spelled one way.");
  }

  async function undo() {
    if (!batch) return;
    setPending("undo");
    const result = await undoSettleAction(batch.batchId);
    setPending(null);
    if (!result.ok) return showSnackbar({ message: result.message });
    setBatch(null);
    const { restored, kept } = result.data;
    setNote(`Put back ${plural(restored, "change")}${kept > 0 ? `, and left ${plural(kept, "book")} you've edited since` : ""}.`);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="tonal" icon={iconSort} isPending={pending === "settle"} isDisabled={pending !== null} onPress={() => void settle()}>
          Settle series and author spellings
        </Button>
        {batch && (
          <Button variant="text" icon={iconUndo} isPending={pending === "undo"} isDisabled={pending !== null} onPress={() => void undo()}>
            {`Undo (${plural(batch.books, "book")})`}
          </Button>
        )}
      </div>
      <p className="text-body-sm text-on-surface-variant" aria-live="polite">
        {note ?? "Joins spellings of one series or one author, such as \u201cChronicles of Narnia\u201d and \u201cThe Chronicles of Narnia\u201d."}
      </p>
    </div>
  );
}
