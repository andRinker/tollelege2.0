"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { Form } from "react-aria-components";
import type { BookSelection, HandoverSummary } from "@/server/handover";
import { Button } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/dialog";
import { ListBoxItem } from "@/ui/components/menu";
import { Select } from "@/ui/components/select";
import { Checkbox, Radio, RadioGroup } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import { IconButton } from "@/ui/components/icon-button";
import { iconAdd, iconMail, iconMoveItem, iconRemove, iconSearch } from "@/ui/icons/generated";
import { offerHandoverAction, withdrawHandoverAction } from "../handover-actions";

type Choices = {
  classes: { id: string; name: string; schoolYear: string; archived: boolean; students: number }[];
  books: { id: string; title: string; authors: string[]; copies: number }[];
  tags: { name: string; books: number }[];
  locations: { name: string; books: number }[];
};

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-5 medium:p-6 [--field-bg:var(--md-sys-color-surface-container-low)]">
      <div className="flex flex-col gap-1">
        <h2 className="text-title-lg-em">{title}</h2>
        {description && <p className="text-body-md text-on-surface-variant">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function HandoverForm({ choices }: { choices: Choices }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [email, setEmail] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [bookKind, setBookKind] = useState<BookSelection["kind"]>("none");
  const [tag, setTag] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  // Picked titles, each with how many of its copies go.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return choices.books;
    return choices.books.filter(
      (book) => book.title.toLowerCase().includes(query) || book.authors.some((author) => author.toLowerCase().includes(query)),
    );
  }, [choices.books, filter]);

  const bookCount =
    bookKind === "all"
      ? choices.books.length
      : bookKind === "tag"
        ? (choices.tags.find((option) => option.name === tag)?.books ?? 0)
        : bookKind === "location"
          ? (choices.locations.find((option) => option.name === location)?.books ?? 0)
          : bookKind === "picked"
            ? Object.keys(picked).length
            : 0;
  const copyCount = bookKind === "picked" ? Object.values(picked).reduce((sum, n) => sum + n, 0) : null;
  const totalCopies = useMemo(() => new Map(choices.books.map((book) => [book.id, book.copies])), [choices.books]);

  const selection = (): BookSelection | null => {
    if (bookKind === "tag") return tag ? { kind: "tag", tag } : null;
    if (bookKind === "location") return location ? { kind: "location", location } : null;
    if (bookKind === "picked") {
      const books = Object.entries(picked).map(([bookId, copies]) => ({
        bookId,
        // Every copy is the whole title.
        copies: copies >= (totalCopies.get(bookId) ?? 0) ? null : copies,
      }));
      return books.length ? { kind: "picked", books } : null;
    }
    return { kind: bookKind };
  };

  async function submit() {
    setError(null);
    setProblems([]);
    const books = selection();
    if (!books) {
      setError(bookKind === "picked" ? "Choose at least one book." : `Choose a ${bookKind === "tag" ? "tag" : "bin or shelf"}.`);
      return;
    }
    if (classIds.length === 0 && books.kind === "none") {
      setError("Choose at least one class or book to hand over.");
      return;
    }
    setPending(true);
    const result = await offerHandoverAction({ email, classIds, books });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.data.status === "blocked") {
      setProblems(result.data.problems);
      return;
    }
    showSnackbar({ message: `Offered to ${result.data.recipientName}. Nothing moves until they accept.` });
    router.refresh();
  }

  const books = bookCount && plural(bookCount, "book") + (copyCount && copyCount > bookCount ? ` (${plural(copyCount, "copy", "copies")})` : "");
  const summary = [classIds.length && plural(classIds.length, "class", "classes"), books]
    .filter(Boolean)
    .join(" and ");

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex max-w-3xl flex-col gap-4"
    >
      <Section title="Who's taking over" description="They need to have signed in with Google at least once, or have an account your administrator made for them.">
        <TextField label="Their school email" type="email" value={email} onChange={setEmail} isRequired autoComplete="off" leadingIcon={iconMail} />
      </Section>

      <Section
        title="Classes"
        description="Each class takes its students and their reading history with it. You'll stay on as a co-teacher, and they can remove you."
      >
        {choices.classes.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">You have no classes.</p>
        ) : (
          <div className="flex flex-col">
            {choices.classes.map((klass) => (
              <Checkbox
                key={klass.id}
                isSelected={classIds.includes(klass.id)}
                onChange={(on) => setClassIds((ids) => (on ? [...ids, klass.id] : ids.filter((id) => id !== klass.id)))}
              >
                <span>
                  {klass.name}
                  <span className="text-body-md text-on-surface-variant">
                    {` · ${plural(klass.students, "student")} · ${klass.schoolYear}${klass.archived ? " · archived" : ""}`}
                  </span>
                </span>
              </Checkbox>
            ))}
          </div>
        )}
      </Section>

      <Section title="Books" description="Copies they already have join their copy of the title, so nothing is listed twice.">
        <RadioGroup aria-label="Which books" value={bookKind} onChange={(value) => setBookKind(value as BookSelection["kind"])}>
          <Radio value="none">No books</Radio>
          <Radio value="all">{`All of them (${choices.books.length})`}</Radio>
          <Radio value="tag" isDisabled={choices.tags.length === 0}>
            With a tag
          </Radio>
          <Radio value="location" isDisabled={choices.locations.length === 0}>
            In a bin or shelf
          </Radio>
          <Radio value="picked" isDisabled={choices.books.length === 0}>
            Let me choose
          </Radio>
        </RadioGroup>
        {bookKind === "tag" && (
          <Select label="Tag" selectedKey={tag} onSelectionChange={(key) => setTag(key as string)} items={choices.tags.map((option) => ({ id: option.name, ...option }))}>
            {(item) => <ListBoxItem id={item.id}>{`${item.name} (${item.books})`}</ListBoxItem>}
          </Select>
        )}
        {bookKind === "location" && (
          <Select
            label="Bin or shelf"
            selectedKey={location}
            onSelectionChange={(key) => setLocation(key as string)}
            items={choices.locations.map((option) => ({ id: option.name, ...option }))}
          >
            {(item) => <ListBoxItem id={item.id}>{`${item.name} (${item.books})`}</ListBoxItem>}
          </Select>
        )}
        {bookKind === "picked" && (
          <div className="flex flex-col gap-2">
            <TextField label="Find a book" value={filter} onChange={setFilter} leadingIcon={iconSearch} autoComplete="off" />
            <p className="text-body-sm text-on-surface-variant">
              {`${plural(bookCount, "book")} chosen. For a title with several copies, choose how many to give; you keep the rest.`}
            </p>
            <div className="flex max-h-96 flex-col overflow-y-auto rounded-md bg-surface-container px-2">
              {shown.map((book) => {
                const chosen = picked[book.id];
                return (
                  <div key={book.id} className="flex min-h-12 items-center gap-2">
                    <Checkbox
                      className="min-w-0 grow"
                      isSelected={chosen !== undefined}
                      onChange={(on) =>
                        setPicked((current) => {
                          const next = { ...current };
                          if (on) next[book.id] = book.copies;
                          else delete next[book.id];
                          return next;
                        })
                      }
                    >
                      <span className="truncate">
                        {book.title}
                        {book.authors.length > 0 && <span className="text-body-md text-on-surface-variant">{` · ${book.authors.join(", ")}`}</span>}
                      </span>
                    </Checkbox>
                    {chosen !== undefined && book.copies > 1 && (
                      <CopyStepper
                        title={book.title}
                        value={chosen}
                        max={book.copies}
                        onChange={(value) => setPicked((current) => ({ ...current, [book.id]: value }))}
                      />
                    )}
                  </div>
                );
              })}
              {shown.length === 0 && <p className="px-2 py-3 text-body-md text-on-surface-variant">No books match.</p>}
            </div>
          </div>
        )}
      </Section>

      {error && (
        <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <p className="text-title-sm">Sort these out first, then offer it again:</p>
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {summary && <span className="text-body-md text-on-surface-variant">{summary}</span>}
        <Button type="submit" icon={iconMoveItem} isPending={pending}>
          Offer to hand over
        </Button>
      </div>
    </Form>
  );
}

/** How many of a title's copies go: at least one, at most all of them. */
function CopyStepper({ title, value, max, onChange }: { title: string; value: number; max: number; onChange: (value: number) => void }) {
  return (
    <div role="group" aria-label={`Copies of ${title} to give`} className="flex shrink-0 items-center gap-1">
      <IconButton icon={iconRemove} label={`One fewer copy of ${title}`} isDisabled={value <= 1} onPress={() => onChange(value - 1)} />
      <span className="min-w-16 text-center text-body-md tabular-nums" aria-live="polite">{`${value} of ${max}`}</span>
      <IconButton icon={iconAdd} label={`One more copy of ${title}`} isDisabled={value >= max} onPress={() => onChange(value + 1)} />
    </div>
  );
}

/** The offer that's out, waiting on the recipient. */
export function PendingHandover({ offer }: { offer: HandoverSummary }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [confirming, setConfirming] = useState(false);
  const books = offer.books && plural(offer.books, "book") + (offer.copies > offer.books ? ` (${plural(offer.copies, "copy", "copies")})` : "");
  const what = [offer.classNames.join(", "), books].filter(Boolean).join(" and ");
  return (
    <Section title={`Waiting for ${offer.toName}`} description={`You've offered ${offer.toName} (${offer.toEmail}) ${what}. Nothing moves until they accept it, from their Home page.`}>
      <div className="flex justify-end">
        <Button variant="outlined" onPress={() => setConfirming(true)}>
          Withdraw the offer
        </Button>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Withdraw the offer?"
        message={`${offer.toName} won't be able to accept it. You can offer again at any time.`}
        confirmLabel="Withdraw"
        onConfirm={async () => {
          const result = await withdrawHandoverAction(offer.id);
          showSnackbar({ message: result.ok ? "Offer withdrawn" : result.message });
          router.refresh();
        }}
      />
    </Section>
  );
}
