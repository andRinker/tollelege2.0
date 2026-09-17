"use client";

import { useMemo, useRef, useState } from "react";
import { Form } from "react-aria-components";
import { BarcodeScannerDialog } from "@/components/barcode-scanner";
import { BookCover } from "@/components/book-cover";
import { LoanActions, useReturnWithUndo } from "@/components/loan-actions";
import { useBarcodeWedge } from "@/components/use-barcode-wedge";
import { describeDueDate, formatInstant } from "@/lib/dates";
import { formatIsbn13 } from "@/lib/isbn";
import type { OpenLoan } from "@/server/circulation";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";
import { ConnectedButton, ConnectedButtonGroup } from "@/ui/components/button-group";
import { Dialog } from "@/ui/components/dialog";
import { Avatar, EmptyState, PageHeader } from "@/ui/components/expressive";
import { Icon } from "@/ui/components/icon";
import { List, ListItem } from "@/ui/components/list";
import { useSnackbar } from "@/ui/components/snackbar";
import { SearchField, TextField } from "@/ui/components/text-field";
import { iconBarcodeScanner, iconCelebration, iconError, iconInput, iconPhotoCamera, iconSearch } from "@/ui/icons/generated";
import { checkInByIsbnAction, type IsbnCheckInResult, undoCheckInAction } from "../checkout/actions";

type Choice = Extract<IsbnCheckInResult, { status: "choose" }>;

type Props = {
  loans: OpenLoan[];
  today: string;
  timeZone: string | null;
  initialFilter: "all" | "overdue";
};

export function CheckinFlow({ loans, today, timeZone, initialFilter }: Props) {
  const showSnackbar = useSnackbar();
  const returnBook = useReturnWithUndo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isbn, setIsbn] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastReturn, setLastReturn] = useState<string | null>(null);
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");

  const overdueCount = loans.filter((loan) => loan.overdue).length;
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return loans.filter((loan) => {
      if (filter === "overdue" && !loan.overdue) return false;
      const haystack = `${loan.title} ${loan.studentName} ${loan.className ?? ""}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [loans, filter, query]);

  function handleResult(response: IsbnCheckInResult) {
    setNotice(null);
    switch (response.status) {
      case "returned":
        setLastReturn(`${response.result.title} from ${response.result.studentName}`);
        showSnackbar({
          message: `Returned ${response.result.title} from ${response.result.studentName}`,
          action: {
            label: "Undo",
            onAction: async () => {
              const undo = await undoCheckInAction(response.result.loanId);
              if (!undo.ok) showSnackbar({ message: undo.message });
            },
          },
        });
        break;
      case "choose":
        setScannerOpen(false);
        setChoice(response);
        break;
      case "none_out":
        setNotice(`No copies of ${response.title} are checked out.`);
        break;
      case "not_in_library":
        setNotice(`ISBN ${formatIsbn13(response.isbn13)} isn't in your library.`);
        break;
      case "invalid":
        setNotice("That isn't a valid ISBN. Check the digits and try again.");
        break;
      case "error":
        setNotice(response.message);
        break;
    }
  }

  async function submit(value: string) {
    if (!value.trim()) {
      setNotice("Scan or type the ISBN of the book being returned.");
      return;
    }
    setPending(true);
    handleResult(await checkInByIsbnAction(value));
    setPending(false);
    setIsbn("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // A scan still works when focus has wandered to a button.
  useBarcodeWedge((code) => void submit(code), !scannerOpen);

  return (
    <>
      <PageHeader title="Check in" subtitle={loans.length > 0 ? `${loans.length} ${loans.length === 1 ? "book is" : "books are"} checked out` : undefined} />

      <div className="grid grid-cols-1 gap-4 expanded:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] expanded:items-start">
        <section className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-4 medium:p-6 [--field-bg:var(--md-sys-color-surface-container-low)]">
          <Form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(isbn);
            }}
          >
            <TextField
              label="Scan or type the book's ISBN"
              leadingIcon={iconBarcodeScanner}
              value={isbn}
              onChange={(value) => {
                setIsbn(value);
                setNotice(null);
              }}
              inputRef={inputRef}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              inputClassName="tabular-nums"
              description="If only one copy is out, it's returned right away."
            />
            {notice && (
              <div role="alert" className="flex items-center gap-3 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
                <Icon icon={iconError} size={20} />
                {notice}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="md" icon={iconInput} isPending={pending} className="grow medium:grow-0">
                Check in
              </Button>
              <Button variant="tonal" size="md" icon={iconPhotoCamera} onPress={() => setScannerOpen(true)} className="grow medium:grow-0">
                Scan with camera
              </Button>
            </div>
          </Form>
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          {loans.length === 0 ? (
            <EmptyState icon={iconCelebration} shape="sunny" title="Everything's on the shelf" description="No books are checked out right now." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <ConnectedButtonGroup
                  aria-label="Show"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[filter]}
                  onSelectionChange={(keys) => setFilter([...keys][0] as "all" | "overdue")}
                >
                  <ConnectedButton id="all">All ({loans.length})</ConnectedButton>
                  <ConnectedButton id="overdue">Overdue ({overdueCount})</ConnectedButton>
                </ConnectedButtonGroup>
              </div>
              <SearchField placeholder="Filter by title, student, or class" aria-label="Filter checked-out books" value={query} onChange={setQuery} />
              {visible.length === 0 ? (
                <EmptyState icon={iconSearch} shape="softBurst" title={filter === "overdue" ? "Nothing is overdue" : "No matches"} />
              ) : (
                <List aria-label="Checked-out books">
                  {visible.map((loan) => (
                    <ListItem
                      key={loan.loanId}
                      leading={
                        <div className="w-10">
                          <BookCover title={loan.title} coverUrl={loan.coverUrl} size="sm" className="rounded-xs" />
                        </div>
                      }
                      headline={loan.title}
                      supporting={
                        <>
                          {loan.studentName}
                          {loan.className && ` · ${loan.className}`}
                          {" · "}
                          <span className={cx(loan.overdue && "text-error")}>
                            {loan.dueOn ? describeDueDate(loan.dueOn, today) : `Since ${formatInstant(new Date(loan.checkedOutAt), timeZone, today)}`}
                          </span>
                        </>
                      }
                      href={`/students/${loan.studentId}`}
                      actions={<LoanActions loanId={loan.loanId} title={loan.title} studentName={loan.studentName} />}
                    />
                  ))}
                </List>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog
        isOpen={choice !== null}
        onOpenChange={(open) => !open && setChoice(null)}
        title="Who is returning it?"
        actions={(close) => (
          <Button variant="text" onPress={close}>
            Cancel
          </Button>
        )}
      >
        {choice && (
          <div className="flex flex-col gap-3">
            <p>
              More than one copy of <span className="text-on-surface">{choice.title}</span> is checked out.
            </p>
            <List aria-label="Students with this book">
              {choice.loans.map((loan) => (
                <ListItem
                  key={loan.loanId}
                  leading={<Avatar name={loan.studentName} />}
                  headline={loan.studentName}
                  supporting={
                    <span className={cx(loan.overdue && "text-error")}>
                      {[loan.className, `Copy ${loan.copyNumber}`, loan.dueOn && describeDueDate(loan.dueOn, today)].filter(Boolean).join(" · ")}
                    </span>
                  }
                  onAction={async () => {
                    setChoice(null);
                    if (await returnBook(loan.loanId)) setLastReturn(`${choice.title} from ${loan.studentName}`);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                />
              ))}
            </List>
          </div>
        )}
      </Dialog>

      <BarcodeScannerDialog
        isOpen={scannerOpen}
        onOpenChange={setScannerOpen}
        title="Check in books"
        onDetected={async (code) => handleResult(await checkInByIsbnAction(code))}
        status={
          notice ? (
            <p className="text-center text-body-lg text-error">{notice}</p>
          ) : lastReturn ? (
            <p className="text-center text-title-md">Returned {lastReturn}</p>
          ) : undefined
        }
      />
    </>
  );
}
