"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Form } from "react-aria-components";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { TextField } from "@/ui/components/text-field";
import { iconPersonAdd } from "@/ui/icons/generated";
import { createColleagueAction } from "./actions";

/** Makes an account for someone who hasn't signed up yet, then opens it to be built. */
export function CreateColleague() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setEmail("");
    setError(null);
  }

  async function create() {
    setPending(true);
    const result = await createColleagueAction(name, email);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    reset();
    router.push(`/admin/teachers/${result.data.id}`);
  }

  return (
    <>
      <Button variant="tonal" icon={iconPersonAdd} onPress={() => setOpen(true)} className="self-start">
        Create an account for a colleague
      </Button>
      <Dialog
        isOpen={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        title="Create an account for a colleague"
        actions={(close) => (
          <>
            <Button variant="text" onPress={close}>
              Cancel
            </Button>
            <Button type="submit" form="create-colleague-form" isPending={pending}>
              Create
            </Button>
          </>
        )}
      >
        <Form
          id="create-colleague-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          className="flex flex-col gap-4 [--field-bg:var(--md-sys-color-surface-container-high)]"
        >
          <p className="text-body-md text-on-surface-variant">
            Set up their library before they&rsquo;ve signed up: act as them to add books and classes. The first time they
            sign in with Google using this email, they land in it, ready to use.
          </p>
          {error && (
            <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}
          <TextField label="Their name" value={name} onChange={setName} isRequired autoFocus />
          <TextField
            label="Their school email"
            type="email"
            value={email}
            onChange={setEmail}
            isRequired
            autoComplete="off"
            description="The one they'll sign in to Google with."
          />
        </Form>
      </Dialog>
    </>
  );
}
