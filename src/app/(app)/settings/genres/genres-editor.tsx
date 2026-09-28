"use client";

import { useState } from "react";
import { Form } from "react-aria-components";
import { ColorSwatches, GenreDot } from "@/components/genre";
import type { GenreColor } from "@/db/schema/enums";
import type { Genre } from "@/server/genres";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { IconButton } from "@/ui/components/icon-button";
import { Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import { iconAdd, iconDelete, iconEdit, iconKeyboardArrowDown, iconKeyboardArrowUp, iconMoreVert } from "@/ui/icons/generated";
import { createGenreAction, deleteGenreAction, moveGenreAction, updateGenreAction } from "./actions";

const booksLabel = (count: number) => (count === 1 ? "1 book" : `${count} books`);

/**
 * A teacher's genres: what each is called, the colour of its dot, and the order they're listed
 * in wherever a genre is picked. Every change saves at once, like the rest of Settings.
 */
export function GenresEditor({ genres }: { genres: Genre[] }) {
  const showSnackbar = useSnackbar();
  const [editing, setEditing] = useState<{ id: string | null; name: string; color: GenreColor } | null>(null);
  const [deleting, setDeleting] = useState<Genre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    if (!editing) return;
    setPending(true);
    const result = editing.id
      ? await updateGenreAction(editing.id, { name: editing.name, color: editing.color })
      : await createGenreAction({ name: editing.name, color: editing.color });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    showSnackbar({ message: editing.id ? `${editing.name.trim()} saved` : `${editing.name.trim()} added` });
    setEditing(null);
    setError(null);
  }

  async function move(genre: Genre, direction: "up" | "down") {
    const result = await moveGenreAction(genre.id, direction);
    if (!result.ok) showSnackbar({ message: result.message });
  }

  return (
    <div className="flex flex-col gap-4">
      {genres.length === 0 ? (
        <p className="text-body-lg text-on-surface-variant">No genres yet. Add one for each colour of dot on your shelves.</p>
      ) : (
        <ol aria-label="Genres" className="flex flex-col divide-y divide-outline-variant overflow-hidden rounded-xl bg-surface-container-low">
          {genres.map((genre, index) => (
            <li key={genre.id} className="flex items-center gap-3 px-4 py-2">
              <GenreDot color={genre.color} className="size-5" />
              <div className="flex min-w-0 grow flex-col">
                <span className="truncate text-body-lg">{genre.name}</span>
                <span className="text-body-sm text-on-surface-variant">{booksLabel(genre.bookCount)}</span>
              </div>
              <IconButton
                icon={iconKeyboardArrowUp}
                label={`Move ${genre.name} up`}
                isDisabled={index === 0}
                onPress={() => void move(genre, "up")}
                className="max-medium:hidden"
              />
              <IconButton
                icon={iconKeyboardArrowDown}
                label={`Move ${genre.name} down`}
                isDisabled={index === genres.length - 1}
                onPress={() => void move(genre, "down")}
                className="max-medium:hidden"
              />
              <MenuTrigger>
                <IconButton icon={iconMoreVert} label={`Actions for ${genre.name}`} tooltip={false} />
                <Menu
                  onAction={(key) => {
                    if (key === "edit") setEditing({ id: genre.id, name: genre.name, color: genre.color });
                    if (key === "up") void move(genre, "up");
                    if (key === "down") void move(genre, "down");
                    if (key === "delete") setDeleting(genre);
                  }}
                  disabledKeys={[...(index === 0 ? ["up"] : []), ...(index === genres.length - 1 ? ["down"] : [])]}
                >
                  <MenuItem id="edit" icon={iconEdit}>
                    Rename or recolour
                  </MenuItem>
                  <MenuItem id="up" icon={iconKeyboardArrowUp}>
                    Move up
                  </MenuItem>
                  <MenuItem id="down" icon={iconKeyboardArrowDown}>
                    Move down
                  </MenuItem>
                  <MenuItem id="delete" icon={iconDelete} destructive>
                    Delete
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </li>
          ))}
        </ol>
      )}

      <Button variant="tonal" icon={iconAdd} className="self-start" onPress={() => setEditing({ id: null, name: "", color: "green" })}>
        Add a genre
      </Button>

      <Dialog
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setError(null);
          }
        }}
        title={editing?.id ? "Edit genre" : "Add a genre"}
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button type="submit" form="genre-form" isPending={pending}>
              Save
            </Button>
          </>
        )}
      >
        {editing && (
          <Form
            id="genre-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="flex flex-col gap-5 pt-1 [--field-bg:var(--md-sys-color-surface-container-high)]"
          >
            {error && (
              <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
                {error}
              </p>
            )}
            <TextField
              label="Name"
              value={editing.name}
              onChange={(name) => setEditing({ ...editing, name })}
              maxLength={60}
              isRequired
              autoFocus
            />
            <ColorSwatches value={editing.color} onChange={(color) => setEditing({ ...editing, color })} label="Dot colour" />
          </Form>
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "genre"}?`}
        message={
          deleting && deleting.bookCount > 0
            ? `${booksLabel(deleting.bookCount)} will have no genre. Nothing else about them changes.`
            : "No books have this genre."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteGenreAction(deleting.id);
          showSnackbar({ message: result.ok ? `${deleting.name} deleted` : result.message });
          setDeleting(null);
        }}
      />
    </div>
  );
}
