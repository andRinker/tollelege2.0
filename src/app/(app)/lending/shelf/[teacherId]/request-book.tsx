"use client";

import { useState } from "react";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import { iconCheckCircle, iconHourglassEmpty, iconLibraryAdd } from "@/ui/icons/generated";
import { requestBookAction } from "../../actions";

type RequestBookButtonProps = {
  ownerTeacherId: string;
  ownerName: string;
  bookId: string;
  title: string;
  availableCopies: number;
  standing: "none" | "requested" | "borrowed";
};

export function RequestBookButton({
  ownerTeacherId,
  ownerName,
  bookId,
  title,
  availableCopies,
  standing,
}: RequestBookButtonProps) {
  const showSnackbar = useSnackbar();
  const [isOpen, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (standing === "borrowed") {
    return (
      <Button variant="text" size="xs" icon={iconCheckCircle} isDisabled>
        On your shelf
      </Button>
    );
  }
  if (standing === "requested") {
    return (
      <Button variant="text" size="xs" icon={iconHourglassEmpty} isDisabled>
        Asked
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="tonal"
        size="xs"
        icon={iconLibraryAdd}
        isDisabled={availableCopies === 0}
        onPress={() => setOpen(true)}
      >
        {availableCopies === 0 ? "All out" : "Ask to borrow"}
      </Button>

      <Dialog
        isOpen={isOpen}
        onOpenChange={(open) => {
          setOpen(open);
          if (!open) setError(null);
        }}
        title={`Ask for ${title}?`}
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button type="submit" form="request-book-form" isPending={pending}>
              Send request
            </Button>
          </>
        )}
      >
        <form
          id="request-book-form"
          className="flex flex-col gap-4 pt-1"
          onSubmit={async (event) => {
            event.preventDefault();
            const message = String(new FormData(event.currentTarget).get("message") ?? "");
            setPending(true);
            const result = await requestBookAction(ownerTeacherId, bookId, message);
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setOpen(false);
            showSnackbar({ message: `Asked ${ownerName} for ${result.data.title}.` });
          }}
        >
          {error && (
            <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}
          <p className="text-body-md text-on-surface-variant">
            {ownerName} decides whether to lend it, and hands you the book in person. It then sits on your shelf for
            your students to check out as usual.
          </p>
          <TextField
            label="Add a note"
            name="message"
            autoFocus
            maxLength={300}
            autoComplete="off"
            description="Optional. What it's for, or when you'd bring it back."
          />
        </form>
      </Dialog>
    </>
  );
}
