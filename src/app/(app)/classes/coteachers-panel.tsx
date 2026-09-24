"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Form } from "react-aria-components";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { Avatar } from "@/ui/components/expressive";
import { Icon } from "@/ui/components/icon";
import { IconButton } from "@/ui/components/icon-button";
import { List, ListItem } from "@/ui/components/list";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import { iconClose, iconGroupAdd, iconLogout, iconMail } from "@/ui/icons/generated";
import {
  addCoTeacherAction,
  cancelCoTeacherInviteAction,
  leaveClassAction,
  removeCoTeacherAction,
} from "./coteacher-actions";

type Props = {
  classId: string;
  className: string;
  coTeachers: { id: string; name: string; email: string }[];
  invites: { id: string; email: string }[];
};

/** The owner's view: who else teaches this class, and who's been asked to. */
export function CoTeachersPanel({ classId, className, coTeachers, invites }: Props) {
  const showSnackbar = useSnackbar();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  async function add() {
    setPending(true);
    const result = await addCoTeacherAction(classId, email);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setAdding(false);
    setEmail("");
    setError(null);
    const { outcome, name, email: added } = result.data;
    showSnackbar({
      message:
        outcome === "added"
          ? `${name ?? added} now co-teaches ${className}`
          : `Invited ${added}. They'll get access the first time they sign in with Google.`,
    });
  }

  return (
    <section aria-labelledby="coteachers-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="coteachers-heading" className="text-title-lg-em">
          Co-teachers
        </h2>
        <Button variant="tonal" size="sm" icon={iconGroupAdd} onPress={() => setAdding(true)}>
          Add a co-teacher
        </Button>
      </div>
      {coTeachers.length === 0 && invites.length === 0 ? (
        <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          Only you teach this class. A co-teacher can check your books out to its students, add books to your library and
          keep the roster, but can&rsquo;t see your other classes, delete books or students, or change lending.
        </p>
      ) : (
        <List aria-label="Co-teachers">
          {coTeachers.map((teacher) => (
            <ListItem
              key={teacher.id}
              leading={<Avatar name={teacher.name} />}
              headline={teacher.name}
              supporting={teacher.email}
              actions={
                <IconButton
                  icon={iconClose}
                  label={`Remove ${teacher.name}`}
                  onPress={() => setRemoving({ id: teacher.id, name: teacher.name })}
                />
              }
            />
          ))}
          {invites.map((invite) => (
            <ListItem
              key={invite.id}
              // No account yet, so no avatar.
              leading={<Icon icon={iconMail} className="mx-2" />}
              headline={invite.email}
              supporting="Invited, waiting for them to sign in with Google"
              actions={
                <IconButton
                  icon={iconClose}
                  label={`Cancel the invitation to ${invite.email}`}
                  onPress={async () => {
                    const result = await cancelCoTeacherInviteAction(invite.id);
                    showSnackbar({ message: result.ok ? `Cancelled the invitation to ${invite.email}` : result.message });
                  }}
                />
              }
            />
          ))}
        </List>
      )}

      <Dialog
        isOpen={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) {
            setEmail("");
            setError(null);
          }
        }}
        title={`Add a co-teacher to ${className}`}
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button type="submit" form="add-coteacher-form" isPending={pending}>
              Add
            </Button>
          </>
        )}
      >
        <Form
          id="add-coteacher-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
          className="flex flex-col gap-4 [--field-bg:var(--md-sys-color-surface-container-high)]"
        >
          <p className="text-body-md text-on-surface-variant">
            They can start straight away if they already sign in with Google. If not, they&rsquo;ll get access the first time
            they do.
          </p>
          {error && (
            <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}
          <TextField
            label="Their school email"
            type="email"
            value={email}
            onChange={setEmail}
            isRequired
            autoFocus
            autoComplete="off"
            leadingIcon={iconMail}
          />
        </Form>
      </Dialog>

      <ConfirmDialog
        isOpen={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        message={`They'll lose access to ${className} straight away. Checkouts they made stay in your classroom.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const result = await removeCoTeacherAction(classId, removing.id);
          showSnackbar({ message: result.ok ? `${removing.name} no longer co-teaches ${className}` : result.message });
        }}
      />
    </section>
  );
}

/** A co-teacher's view of the same place: whose class this is, and a way out. */
export function CoTeachingNote({ classId, className, ownerName }: { classId: string; className: string; ownerName: string }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-low px-5 py-4">
      <p className="text-body-md text-on-surface-variant">{`You co-teach ${className} with ${ownerName}. It's their class.`}</p>
      <Button variant="text" size="sm" icon={iconLogout} onPress={() => setConfirming(true)}>
        Leave this class
      </Button>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={`Leave ${className}?`}
        message={`You'll lose access straight away. ${ownerName} can add you again.`}
        confirmLabel="Leave"
        destructive
        onConfirm={async () => {
          const result = await leaveClassAction(classId);
          if (!result.ok) {
            showSnackbar({ message: result.message });
            return;
          }
          showSnackbar({ message: `You've left ${className}` });
          router.replace(result.data.stillCoTeaching ? "/classes" : "/dashboard");
          router.refresh();
        }}
      />
    </section>
  );
}
