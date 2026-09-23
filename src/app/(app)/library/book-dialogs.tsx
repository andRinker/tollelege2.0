"use client";

import { useState } from "react";
import { Form } from "react-aria-components";
import { BookFields, bookInputFromForm, type BookFormValue } from "@/components/book-form";
import type { ReadingLevelSystem } from "@/db/schema/enums";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { useSnackbar } from "@/ui/components/snackbar";
import { deleteBookAction, updateBookAction } from "./actions";

export type BookSuggestions = { tags: string[]; locations: string[] };

/**
 * Editing a book's details, shared by the book's own page and the library list so the two
 * can't drift apart. Open while `value` is set; closing hands back `null`.
 */
export function EditBookDialog({
  bookId,
  value,
  onChange,
  readingLevelSystem,
  suggestions,
}: {
  bookId: string;
  value: BookFormValue | null;
  onChange: (value: BookFormValue | null) => void;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: BookSuggestions;
}) {
  const showSnackbar = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formId = `edit-book-form-${bookId}`;

  async function save() {
    if (!value) return;
    setPending(true);
    const result = await updateBookAction(bookId, bookInputFromForm(value));
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChange(null);
    setError(null);
    showSnackbar({ message: "Book details saved" });
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
      title="Edit book"
      fullScreenOnCompact
      actions={(close) => (
        <>
          <Button variant="text" onPress={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} isPending={pending}>
            Save
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
        </Form>
      )}
    </Dialog>
  );
}

/** Confirms deleting a whole title. `onDeleted` runs only once the server has agreed. */
export function DeleteBookDialog({
  bookId,
  title,
  isOpen,
  onOpenChange,
  onDeleted,
}: {
  bookId: string;
  title: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const showSnackbar = useSnackbar();
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Delete this book?"
      message={`${title} and all its copies will be removed from your library. Students who have read it keep it in their reading history. This can't be undone.`}
      confirmLabel="Delete"
      destructive
      onConfirm={async () => {
        const result = await deleteBookAction(bookId);
        if (!result.ok) {
          showSnackbar({ message: result.message });
          return;
        }
        showSnackbar({ message: `Deleted ${title}` });
        onDeleted?.();
      }}
    />
  );
}
