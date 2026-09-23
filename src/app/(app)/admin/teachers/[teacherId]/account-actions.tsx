"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import { iconDelete, iconEdit, iconLogout } from "@/ui/icons/generated";
import { deleteTeacherAction, signOutTeacherAction } from "../../actions";

type Props = {
  teacherId: string;
  name: string;
  email: string;
  /** Your own account, or another admin's: neither can be acted as or deleted from here. */
  isProtected: boolean;
};

export function AccountActions({ teacherId, name, email, isProtected }: Props) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [starting, setStarting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  async function actAs() {
    setStarting(true);
    const response = await fetch("/api/auth/act-as/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: teacherId }),
    });
    setStarting(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      showSnackbar({ message: body?.message ?? "Couldn't open that account." });
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!isProtected && (
        <Button icon={iconEdit} isPending={starting} onPress={() => void actAs()}>
          {`Act as ${name}`}
        </Button>
      )}
      <Button variant="tonal" icon={iconLogout} onPress={() => setConfirmSignOut(true)}>
        Sign out everywhere
      </Button>
      {!isProtected && (
        <Button variant="text" icon={iconDelete} onPress={() => setDeleting(true)}>
          Delete account
        </Button>
      )}

      <ConfirmDialog
        isOpen={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={`Sign ${name} out everywhere?`}
        message="Every browser they're signed in on is signed out, within five minutes, and any paired phone stops scanning. Nothing in their account changes."
        confirmLabel="Sign out"
        onConfirm={async () => {
          const result = await signOutTeacherAction(teacherId);
          showSnackbar({ message: result.ok ? `${name} is signed out everywhere` : result.message });
        }}
      />

      <Dialog
        isOpen={deleting}
        onOpenChange={(open) => {
          setDeleting(open);
          if (!open) {
            setTyped("");
            setDeleteError(null);
          }
        }}
        title={`Delete ${name}'s account?`}
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button
              isPending={deletePending}
              isDisabled={typed.trim().toLowerCase() !== email.toLowerCase()}
              onPress={async () => {
                setDeletePending(true);
                const result = await deleteTeacherAction(teacherId, typed);
                setDeletePending(false);
                if (!result.ok) {
                  setDeleteError(result.message);
                  return;
                }
                close();
                showSnackbar({ message: `Deleted ${result.data.email}` });
                router.replace("/admin");
              }}
            >
              Delete everything
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-md text-on-surface-variant">
            Their library, classes, students and checkout history are all deleted, along with the account itself. This
            can&rsquo;t be undone.
          </p>
          {deleteError && (
            <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {deleteError}
            </p>
          )}
          <TextField
            label={`Type ${email} to confirm`}
            value={typed}
            onChange={setTyped}
            autoComplete="off"
            className="[--field-bg:var(--md-sys-color-surface-container-high)]"
          />
        </div>
      </Dialog>
    </div>
  );
}
