"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Form } from "react-aria-components";
import { BookFields, bookFormFromBook, bookInputFromForm, type BookFormValue } from "@/components/book-form";
import type { books } from "@/db/schema";
import type { CopyStatus, ReadingLevelSystem } from "@/db/schema/enums";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { IconButton } from "@/ui/components/icon-button";
import { Menu, MenuDivider, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { useSnackbar } from "@/ui/components/snackbar";
import {
  iconBlock,
  iconDelete,
  iconEdit,
  iconHealing,
  iconLibraryAdd,
  iconMoreVert,
  iconReport,
  iconRestartAlt,
} from "@/ui/icons/generated";
import {
  addCopyAction,
  deleteBookAction,
  deleteCopyAction,
  setCopyStatusAction,
  updateBookAction,
} from "../actions";

type Book = typeof books.$inferSelect;

export function BookActions({
  book,
  readingLevelSystem,
  suggestions,
}: {
  book: Book;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: { tags: string[]; locations: string[] };
}) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [editing, setEditing] = useState<BookFormValue | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    if (!editing) return;
    setPending(true);
    const result = await updateBookAction(book.id, bookInputFromForm(editing));
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(null);
    setError(null);
    showSnackbar({ message: "Book details saved" });
  }

  return (
    <>
      <Button variant="tonal" size="md" icon={iconEdit} onPress={() => setEditing(bookFormFromBook(book))}>
        Edit details
      </Button>
      <MenuTrigger>
        <IconButton icon={iconMoreVert} label="More actions" size="md" variant="standard" />
        <Menu onAction={(key) => key === "delete" && setConfirmDelete(true)}>
          <MenuItem id="delete" icon={iconDelete} destructive>
            Delete book
          </MenuItem>
        </Menu>
      </MenuTrigger>

      <Dialog
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
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
            <Button type="submit" form="edit-book-form" isPending={pending}>
              Save
            </Button>
          </>
        )}
      >
        {editing && (
          <Form
            id="edit-book-form"
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
            <BookFields value={editing} onChange={setEditing} readingLevelSystem={readingLevelSystem} suggestions={suggestions} />
          </Form>
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this book?"
        message={`${book.title} and all its copies will be removed from your library. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const result = await deleteBookAction(book.id);
          if (!result.ok) {
            showSnackbar({ message: result.message });
            return;
          }
          showSnackbar({ message: `Deleted ${book.title}` });
          router.replace("/library");
        }}
      />
    </>
  );
}

export function AddCopyButton({ bookId }: { bookId: string }) {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="tonal"
      icon={iconLibraryAdd}
      isPending={pending}
      onPress={async () => {
        setPending(true);
        const result = await addCopyAction(bookId);
        setPending(false);
        showSnackbar({ message: result.ok ? `Copy added. You now have ${result.data.totalCopies}.` : result.message });
      }}
    >
      Add a copy
    </Button>
  );
}

type CopyMenuProps = {
  bookId: string;
  copyId: string;
  copyNumber: number;
  status: CopyStatus;
  isCheckedOut: boolean;
  canDelete: boolean;
};

export function CopyMenu({ bookId, copyId, copyNumber, status, isCheckedOut, canDelete }: CopyMenuProps) {
  const showSnackbar = useSnackbar();
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function setStatus(next: CopyStatus, message: string) {
    const result = await setCopyStatusAction(bookId, copyId, next);
    showSnackbar({ message: result.ok ? message : result.message });
  }

  return (
    <>
      <MenuTrigger>
        <IconButton icon={iconMoreVert} label={`Actions for copy ${copyNumber}`} tooltip={false} />
        <Menu
          disabledKeys={isCheckedOut ? ["damaged", "lost", "withdrawn"] : []}
          onAction={(key) => {
            if (key === "damaged") void setStatus("damaged", `Copy ${copyNumber} marked damaged`);
            if (key === "lost") void setStatus("lost", `Copy ${copyNumber} marked lost`);
            if (key === "withdrawn") void setStatus("withdrawn", `Copy ${copyNumber} withdrawn`);
            if (key === "restore") void setStatus("in_circulation", `Copy ${copyNumber} is back in circulation`);
            if (key === "delete") setConfirmDelete(true);
          }}
        >
          {status === "in_circulation" ? (
            <>
              <MenuItem id="damaged" icon={iconHealing}>
                Mark damaged
              </MenuItem>
              <MenuItem id="lost" icon={iconReport}>
                Mark lost
              </MenuItem>
              <MenuItem id="withdrawn" icon={iconBlock}>
                Withdraw
              </MenuItem>
            </>
          ) : (
            <MenuItem id="restore" icon={iconRestartAlt}>
              Return to circulation
            </MenuItem>
          )}
          {canDelete && (
            <>
              <MenuDivider />
              <MenuItem id="delete" icon={iconDelete} destructive>
                Delete copy
              </MenuItem>
            </>
          )}
        </Menu>
      </MenuTrigger>
      <ConfirmDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete copy ${copyNumber}?`}
        message="Use this for a copy that was added by mistake. To keep its record, withdraw it instead."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const result = await deleteCopyAction(bookId, copyId);
          showSnackbar({ message: result.ok ? `Copy ${copyNumber} deleted` : result.message });
        }}
      />
    </>
  );
}
