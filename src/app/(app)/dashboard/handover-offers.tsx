"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/components/button";
import { ConfirmDialog, Dialog } from "@/ui/components/dialog";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconMoveItem } from "@/ui/icons/generated";
import { acceptHandoverAction, declineHandoverAction } from "../settings/handover-actions";

type Offer = { id: string; fromName: string; classNames: string[]; books: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describe(offer: Offer) {
  const classes = offer.classNames.length
    ? `${new Intl.ListFormat("en", { type: "conjunction" }).format(offer.classNames)}, with ${offer.classNames.length === 1 ? "its" : "their"} students and reading history`
    : null;
  return [classes, offer.books ? plural(offer.books, "book") : null].filter(Boolean).join(", and ");
}

/** Classes and books another teacher wants to hand to this one. */
export function HandoverOffers({ offers }: { offers: Offer[] }) {
  return (
    <section aria-label="Hand-overs waiting for you" className="flex flex-col gap-3">
      {offers.map((offer) => (
        <OfferCard key={offer.id} offer={offer} />
      ))}
    </section>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);

  async function accept() {
    setAccepting(true);
    const result = await acceptHandoverAction(offer.id);
    setAccepting(false);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      router.refresh();
      return;
    }
    if (result.data.status === "blocked") {
      setProblems(result.data.problems);
      return;
    }
    const { classes, books, joined } = result.data;
    const moved = [classes && plural(classes, "class", "classes"), books && plural(books, "book")].filter(Boolean).join(" and ");
    showSnackbar({
      message: `Now yours: ${moved}.${joined ? ` ${plural(joined, "title")} joined copies you already had.` : ""}`,
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-tertiary-container p-4 text-on-tertiary-container medium:flex-row medium:items-center medium:p-5">
      <p className="grow text-body-lg">
        <strong className="font-medium">{offer.fromName}</strong>
        {` wants to hand you ${describe(offer)}. They'll stay on as a co-teacher of any class, and you can remove them.`}
      </p>
      <div className="flex shrink-0 gap-2 self-end medium:self-auto">
        <Button variant="text" onPress={() => setDeclining(true)}>
          Decline
        </Button>
        <Button icon={iconMoveItem} isPending={accepting} onPress={() => void accept()}>
          Accept
        </Button>
      </div>

      <ConfirmDialog
        isOpen={declining}
        onOpenChange={setDeclining}
        title="Decline the hand-over?"
        message={`Nothing moves, and ${offer.fromName} can offer it again.`}
        confirmLabel="Decline"
        onConfirm={async () => {
          const result = await declineHandoverAction(offer.id);
          showSnackbar({ message: result.ok ? "Declined" : result.message });
          router.refresh();
        }}
      />
      <Dialog
        isOpen={problems !== null}
        onOpenChange={(open) => !open && setProblems(null)}
        title="Not yet"
        actions={(close) => <Button onPress={close}>OK</Button>}
      >
        <div className="flex flex-col gap-3 text-body-md">
          <p>{`Something has changed since ${offer.fromName} offered this. They need to sort these out first, then you can accept:`}</p>
          <ul className="list-disc pl-5">
            {problems?.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="text-on-surface-variant">Nothing has moved. The offer is still here.</p>
        </div>
      </Dialog>
    </div>
  );
}
