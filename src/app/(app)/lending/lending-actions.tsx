"use client";

import { useState } from "react";
import { Form } from "react-aria-components";
import { addDays } from "@/lib/dates";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { IconButton } from "@/ui/components/icon-button";
import { ListBoxItem } from "@/ui/components/menu";
import { Select } from "@/ui/components/select";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import {
  iconAssignmentReturn,
  iconCheck,
  iconClose,
  iconPersonAdd,
  iconPersonRemove,
} from "@/ui/icons/generated";
import {
  approveRequestAction,
  cancelRequestAction,
  declineRequestAction,
  inviteTeacherAction,
  removeConnectionAction,
  respondToInvitationAction,
  returnLoanAction,
} from "./actions";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
      {message}
    </p>
  );
}

export function InviteTeacherButton({ variant = "filled" }: { variant?: "filled" | "tonal" }) {
  const showSnackbar = useSnackbar();
  const [isOpen, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <>
      <Button variant={variant} icon={iconPersonAdd} size="md" onPress={() => setOpen(true)}>
        Invite a teacher
      </Button>
      <Dialog
        isOpen={isOpen}
        onOpenChange={(open) => {
          setOpen(open);
          if (!open) setError(null);
        }}
        title="Invite a teacher"
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button type="submit" form="invite-teacher-form" isPending={pending}>
              Send
            </Button>
          </>
        )}
      >
        <Form
          id="invite-teacher-form"
          className="flex flex-col gap-4 pt-1"
          onSubmit={async (event) => {
            event.preventDefault();
            const email = String(new FormData(event.currentTarget).get("email") ?? "");
            setPending(true);
            const result = await inviteTeacherAction(email);
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setOpen(false);
            showSnackbar({ message: result.data.message });
          }}
        >
          <FormError message={error} />
          <TextField
            label="Their email address"
            name="email"
            type="email"
            isRequired
            autoFocus
            maxLength={200}
            autoComplete="off"
            description="They'll see your invitation next time they sign in. Once you're connected, you can each browse the other's shelves."
          />
        </Form>
      </Dialog>
    </>
  );
}

export function InvitationActions({ connectionId, name }: { connectionId: string; name: string }) {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);

  async function respond(accept: boolean) {
    setPending(true);
    const result = await respondToInvitationAction(connectionId, accept);
    setPending(false);
    showSnackbar({
      message: result.ok
        ? accept
          ? `You and ${name} are now sharing shelves.`
          : "Invitation declined."
        : result.message,
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="text" size="sm" isDisabled={pending} onPress={() => respond(false)}>
        Decline
      </Button>
      <Button variant="tonal" size="sm" icon={iconCheck} isPending={pending} onPress={() => respond(true)}>
        Accept
      </Button>
    </div>
  );
}

export function DisconnectButton({ connectionId, name }: { connectionId: string; name: string }) {
  const showSnackbar = useSnackbar();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <IconButton
        icon={iconPersonRemove}
        label={`Disconnect from ${name}`}
        tooltip
        onPress={() => setConfirming(true)}
      />
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect from ${name}?`}
        message={`You'll stop seeing each other's shelves. Books already borrowed have to go home first.`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          const result = await removeConnectionAction(connectionId);
          showSnackbar({ message: result.ok ? `Disconnected from ${name}.` : result.message });
        }}
      />
    </>
  );
}

const LOAN_PERIODS = [
  { id: "none", name: "No date — until I ask for it back", days: null },
  { id: "14", name: "Two weeks", days: 14 },
  { id: "28", name: "Four weeks", days: 28 },
  { id: "84", name: "A term (twelve weeks)", days: 84 },
];

type RequestActionsProps = {
  shelfLoanId: string;
  title: string;
  borrowerName: string;
  today: string;
};

export function RequestActions({ shelfLoanId, title, borrowerName, today }: RequestActionsProps) {
  const showSnackbar = useSnackbar();
  const [isOpen, setOpen] = useState(false);
  const [period, setPeriod] = useState("28");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decline() {
    setPending(true);
    const result = await declineRequestAction(shelfLoanId);
    setPending(false);
    showSnackbar({ message: result.ok ? `Declined ${borrowerName}'s request.` : result.message });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="text" size="sm" isDisabled={pending} onPress={decline}>
          Decline
        </Button>
        <Button variant="tonal" size="sm" icon={iconCheck} onPress={() => setOpen(true)}>
          Lend it
        </Button>
      </div>

      <Dialog
        isOpen={isOpen}
        onOpenChange={(open) => {
          setOpen(open);
          if (!open) setError(null);
        }}
        title={`Lend ${title}?`}
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button
              isPending={pending}
              onPress={async () => {
                const days = LOAN_PERIODS.find((option) => option.id === period)?.days ?? null;
                setPending(true);
                const result = await approveRequestAction(shelfLoanId, days ? addDays(today, days) : null);
                setPending(false);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setOpen(false);
                showSnackbar({ message: result.data.message });
              }}
            >
              Lend it
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-4 pt-1">
          <FormError message={error} />
          <p className="text-body-md text-on-surface-variant">
            A free copy leaves your shelf and appears on {borrowerName}&rsquo;s, for their students to check out.
            Hand them the book when you next see them.
          </p>
          <Select
            label="Ask for it back"
            selectedKey={period}
            onSelectionChange={(key) => setPeriod(String(key))}
            items={LOAN_PERIODS}
          >
            {(item) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
          </Select>
        </div>
      </Dialog>
    </>
  );
}

export function CancelRequestButton({ shelfLoanId, title }: { shelfLoanId: string; title: string }) {
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="text"
      size="sm"
      icon={iconClose}
      isPending={pending}
      onPress={async () => {
        setPending(true);
        const result = await cancelRequestAction(shelfLoanId);
        setPending(false);
        showSnackbar({ message: result.ok ? `Withdrew your request for ${title}.` : result.message });
      }}
    >
      Withdraw
    </Button>
  );
}

type ReturnLoanButtonProps = {
  shelfLoanId: string;
  title: string;
  /** True when this teacher owns the book and is recording that it came home. */
  isOwner: boolean;
};

export function ReturnLoanButton({ shelfLoanId, title, isOwner }: ReturnLoanButtonProps) {
  const showSnackbar = useSnackbar();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button variant="tonal" size="sm" icon={iconAssignmentReturn} onPress={() => setConfirming(true)}>
        {isOwner ? "Got it back" : "Send it back"}
      </Button>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={isOwner ? `${title} is back?` : `Send ${title} back?`}
        message={
          isOwner
            ? "The copy returns to your shelf and can be checked out again."
            : "The copy leaves your shelf and goes back to its owner. Anything your students have read stays in their history."
        }
        confirmLabel={isOwner ? "Back on my shelf" : "Send it back"}
        onConfirm={async () => {
          const result = await returnLoanAction(shelfLoanId);
          showSnackbar({ message: result.ok ? `${result.data.title} is home.` : result.message });
        }}
      />
    </>
  );
}
