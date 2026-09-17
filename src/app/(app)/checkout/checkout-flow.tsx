"use client";

import { parseDate } from "@internationalized/date";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, Form } from "react-aria-components";
import { Availability } from "@/components/availability";
import { BarcodeScannerDialog } from "@/components/barcode-scanner";
import { BookCover } from "@/components/book-cover";
import { useBarcodeWedge } from "@/components/use-barcode-wedge";
import { describeDueDate } from "@/lib/dates";
import { formatIsbn13, looksLikeIsbn } from "@/lib/isbn";
import type { CheckoutResult } from "@/server/circulation";
import type { StudentOption } from "@/server/roster";
import { cx } from "@/ui/cx";
import { Button, LinkButton } from "@/ui/components/button";
import { FilterChip } from "@/ui/components/chip";
import { DatePicker } from "@/ui/components/date-picker";
import { Avatar, EmptyState, PageHeader } from "@/ui/components/expressive";
import { Icon } from "@/ui/components/icon";
import { IconButton } from "@/ui/components/icon-button";
import { useSnackbar } from "@/ui/components/snackbar";
import { SearchField, TextField } from "@/ui/components/text-field";
import {
  iconArrowBack,
  iconBarcodeScanner,
  iconCheckCircle,
  iconError,
  iconLibraryAdd,
  iconOutput,
  iconPhotoCamera,
  iconSearch,
  iconUndo,
} from "@/ui/icons/generated";
import { springs } from "@/ui/motion/tokens";
import {
  checkOutAction,
  checkOutByIsbnAction,
  type IsbnCheckoutResult,
  searchBooksToCheckOutAction,
  undoCheckOutAction,
} from "./actions";

type Props = {
  students: StudentOption[];
  classes: Array<{ id: string; name: string }>;
  today: string;
  defaultDueOn: string | null;
  maxBooksPerStudent: number | null;
  initialStudentId: string | null;
};

type SessionItem = CheckoutResult & { undone?: boolean };
type BookResult = Awaited<ReturnType<typeof searchBooksToCheckOutAction>>[number];

const fullName = (student: StudentOption) => `${student.firstName} ${student.lastName}`.trim();

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("flex flex-col gap-4 rounded-xl bg-surface-container-low p-4 medium:p-6 [--field-bg:var(--md-sys-color-surface-container-low)]", className)}>
      {children}
    </section>
  );
}

export function CheckoutFlow({ students, classes, today, defaultDueOn, maxBooksPerStudent, initialStudentId }: Props) {
  const [studentId, setStudentId] = useState<string | null>(
    initialStudentId && students.some((student) => student.id === initialStudentId) ? initialStudentId : null,
  );
  const student = students.find((option) => option.id === studentId) ?? null;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {student ? (
        <motion.div key="checkout" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={springs.defaultSpatial}>
          <CheckoutForStudent
            student={student}
            today={today}
            defaultDueOn={defaultDueOn}
            maxBooksPerStudent={maxBooksPerStudent}
            onDone={() => setStudentId(null)}
          />
        </motion.div>
      ) : (
        <motion.div key="pick" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={springs.defaultSpatial}>
          <StudentPicker students={students} classes={classes} onPick={setStudentId} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StudentPicker({ students, classes, onPick }: { students: StudentOption[]; classes: Props["classes"]; onPick: (id: string) => void }) {
  const showSnackbar = useSnackbar();
  const [classId, setClassId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const scannedBookFirst = looksLikeIsbn(query);

  useBarcodeWedge(() => showSnackbar({ message: "Choose a student first, then scan their book." }));

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return students.filter((student) => {
      if (classId && student.classId !== classId) return false;
      const name = fullName(student).toLowerCase();
      return words.every((word) => name.includes(word));
    });
  }, [students, classId, query]);

  return (
    <>
      <PageHeader title="Check out" subtitle="Who's borrowing a book?" />
      <div className="flex flex-col gap-3 pb-4">
        <SearchField
          placeholder="Find a student"
          aria-label="Find a student"
          value={query}
          onChange={setQuery}
          autoFocus
          onSubmit={() => {
            if (visible.length === 1) onPick(visible[0].id);
          }}
        />
        {classes.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] medium:mx-0 medium:flex-wrap medium:px-0">
            <FilterChip isSelected={classId === null} onChange={() => setClassId(null)}>
              All classes
            </FilterChip>
            {classes.map((klass) => (
              <FilterChip key={klass.id} isSelected={classId === klass.id} onChange={(selected) => setClassId(selected ? klass.id : null)}>
                {klass.name}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {scannedBookFirst ? (
        <EmptyState
          icon={iconBarcodeScanner}
          shape="softBurst"
          title="Choose a student first"
          description="That looks like a book's barcode. Pick who's borrowing it, then scan the book again."
        />
      ) : visible.length === 0 ? (
        <EmptyState icon={iconSearch} shape="softBurst" title="No students match" description="Check the spelling or choose a different class." />
      ) : (
        <ul className="grid grid-cols-2 gap-2 medium:grid-cols-3 expanded:grid-cols-4 large:grid-cols-5">
          {visible.map((student) => {
            const name = fullName(student);
            return (
              <li key={student.id}>
                <AriaButton
                  onPress={() => onPick(student.id)}
                  className="state-layer focus-ring shape-morph flex h-full min-h-20 w-full cursor-pointer items-center gap-3 bg-surface-container-low p-3 text-left [--shape-pressed:12px] [--shape-rest:24px]"
                >
                  <Avatar name={name} size={44} />
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-title-sm text-on-surface">{name}</span>
                    <span className={cx("text-label-md", student.overdue > 0 ? "text-error" : "text-on-surface-variant")}>
                      {student.overdue > 0
                        ? `${student.overdue} overdue`
                        : student.booksOut > 0
                          ? `${student.booksOut} out`
                          : (student.className ?? "")}
                    </span>
                  </span>
                </AriaButton>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function CheckoutForStudent({
  student,
  today,
  defaultDueOn,
  maxBooksPerStudent,
  onDone,
}: {
  student: StudentOption;
  today: string;
  defaultDueOn: string | null;
  maxBooksPerStudent: number | null;
  onDone: () => void;
}) {
  const showSnackbar = useSnackbar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isbn, setIsbn] = useState("");
  const [dueOn, setDueOn] = useState(defaultDueOn);
  const [notice, setNotice] = useState<{ kind: "error" | "not_in_library"; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [session, setSession] = useState<SessionItem[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [bookQuery, setBookQuery] = useState("");
  const [bookResults, setBookResults] = useState<BookResult[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const name = fullName(student);
  const atLimit = maxBooksPerStudent !== null && student.booksOut >= maxBooksPerStudent;

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function recordCheckout(result: CheckoutResult) {
    setSession((items) => [result, ...items]);
    setNotice(null);
    setIsbn("");
    setBookQuery("");
    setBookResults([]);
    setTimeout(() => inputRef.current?.focus(), 0);
    showSnackbar({ message: `${result.title} checked out to ${student.firstName}${result.dueOn ? ` · ${describeDueDate(result.dueOn, today)}` : ""}` });
  }

  function handleIsbnResult(response: IsbnCheckoutResult) {
    if (response.status === "checked_out") recordCheckout(response.result);
    else if (response.status === "invalid") setNotice({ kind: "error", message: "That isn't a valid ISBN. Check the digits and try again." });
    else if (response.status === "not_in_library") setNotice({ kind: "not_in_library", message: `ISBN ${formatIsbn13(response.isbn13)} isn't in your library yet.` });
    else setNotice({ kind: "error", message: response.message });
  }

  async function submitIsbn(value: string) {
    if (!value.trim()) {
      setNotice({ kind: "error", message: "Scan or type an ISBN, or search by title below." });
      return;
    }
    setPending(true);
    handleIsbnResult(await checkOutByIsbnAction({ studentId: student.id, isbn: value, dueOn }));
    setPending(false);
  }

  // A scan still works when focus has wandered to a button.
  useBarcodeWedge((code) => {
    setIsbn("");
    void submitIsbn(code);
  }, !scannerOpen);

  const lastItem = session[0];

  return (
    <>
      <PageHeader
        leading={
          <Button variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start" onPress={onDone}>
            Choose a different student
          </Button>
        }
        title="Check out"
      />

      {/* Phones: student, scan form, session list. Wider: student and session list beside the form. */}
      <div className="grid grid-cols-1 gap-4 expanded:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] expanded:grid-rows-[auto_1fr] expanded:items-start">
        <section className="relative flex items-center gap-4 overflow-hidden rounded-xl bg-primary-container p-5 text-on-primary-container expanded:col-start-1 expanded:row-start-1">
          <Avatar name={name} size={64} />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-headline-sm-em">{name}</h2>
            <p className="text-body-md">
              {[student.className, `${student.booksOut} ${student.booksOut === 1 ? "book" : "books"} out`].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {student.overdue > 0 && (
                <span className="rounded-full bg-error-container px-2.5 py-0.5 text-label-md text-on-error-container">{student.overdue} overdue</span>
              )}
              {atLimit && (
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-label-md text-on-surface">At the {maxBooksPerStudent}-book limit</span>
              )}
            </div>
          </div>
        </section>

        <Section className="expanded:col-start-2 expanded:row-span-2 expanded:row-start-1">
          <Form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitIsbn(isbn);
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
            />
            {notice && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
                <Icon icon={iconError} size={20} />
                <span className="grow">{notice.message}</span>
                {notice.kind === "not_in_library" && (
                  <LinkButton href="/library/add" variant="text" size="xs" icon={iconLibraryAdd} className="text-on-error-container">
                    Add books
                  </LinkButton>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="md" icon={iconOutput} isPending={pending} className="grow medium:grow-0">
                Check out
              </Button>
              <Button variant="tonal" size="md" icon={iconPhotoCamera} onPress={() => setScannerOpen(true)} className="grow medium:grow-0">
                Scan with camera
              </Button>
            </div>
          </Form>

          {defaultDueOn !== null ? (
            <DatePicker
              label="Due date"
              value={dueOn ? parseDate(dueOn) : null}
              minValue={parseDate(today)}
              onChange={(value) => setDueOn(value ? value.toString() : defaultDueOn)}
              description={dueOn ? describeDueDate(dueOn, today) : undefined}
            />
          ) : (
            <p className="text-body-sm text-on-surface-variant">Books are checked out without due dates. You can change this in Settings.</p>
          )}

          <div className="flex flex-col gap-2 border-t border-outline-variant pt-4">
            <SearchField
              placeholder="No barcode? Search by title or author"
              aria-label="Search books by title or author"
              value={bookQuery}
              onChange={(value) => {
                setBookQuery(value);
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(async () => setBookResults(await searchBooksToCheckOutAction(value)), 250);
              }}
              onClear={() => setBookResults([])}
            />
            {bookQuery.trim().length >= 2 && bookResults.length === 0 && (
              <p className="px-2 text-body-md text-on-surface-variant">No books in your library match.</p>
            )}
            {bookResults.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {bookResults.map((book) => (
                  <li key={book.id} className="flex items-center gap-3 rounded-xs bg-surface-container px-3 py-2 first:rounded-t-lg last:rounded-b-lg">
                    <div className="w-10 shrink-0">
                      <BookCover title={book.title} coverUrl={book.coverUrl} size="sm" className="rounded-xs" />
                    </div>
                    <div className="flex min-w-0 grow flex-col">
                      <span className="truncate text-body-lg">{book.title}</span>
                      <Availability available={book.available} total={book.total} />
                    </div>
                    <Button
                      variant="tonal"
                      size="xs"
                      isDisabled={book.available === 0}
                      onPress={async () => {
                        const result = await checkOutAction({ studentId: student.id, bookId: book.id, dueOn });
                        if (result.ok) recordCheckout(result.data);
                        else setNotice({ kind: "error", message: result.message });
                      }}
                    >
                      Check out
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {session.length > 0 && (
          <Section className="expanded:col-start-1 expanded:row-start-2">
            <h2 className="text-title-lg-em">Checked out to {student.firstName}</h2>
            <ul className="flex flex-col gap-0.5">
              <AnimatePresence initial={false}>
                {session.map((item) => (
                  <motion.li
                    key={item.loanId}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={springs.defaultSpatial}
                    className="overflow-hidden rounded-xs bg-surface-container first:rounded-t-lg last:rounded-b-lg"
                  >
                    <div className={cx("flex items-center gap-3 px-3 py-2", item.undone && "opacity-50")}>
                      <div className="w-10 shrink-0">
                        <BookCover title={item.title} coverUrl={item.coverUrl} size="sm" className="rounded-xs" />
                      </div>
                      <div className="flex min-w-0 grow flex-col">
                        <span className={cx("truncate text-body-lg", item.undone && "line-through")}>{item.title}</span>
                        <span className="text-body-sm text-on-surface-variant">
                          {item.undone ? "Undone" : `${item.dueOn ? describeDueDate(item.dueOn, today) : "No due date"} · Copy ${item.copyNumber}`}
                        </span>
                      </div>
                      {!item.undone && (
                        <IconButton
                          icon={iconUndo}
                          label={`Undo checking out ${item.title}`}
                          onPress={async () => {
                            const result = await undoCheckOutAction(item.loanId);
                            if (!result.ok) showSnackbar({ message: result.message });
                            else setSession((items) => items.map((entry) => (entry.loanId === item.loanId ? { ...entry, undone: true } : entry)));
                          }}
                        />
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <Button size="md" icon={iconCheckCircle} onPress={onDone} className="self-start">
              Done, next student
            </Button>
          </Section>
        )}
      </div>

      <BarcodeScannerDialog
        isOpen={scannerOpen}
        onOpenChange={setScannerOpen}
        title={`Check out to ${student.firstName}`}
        onDetected={async (code) => handleIsbnResult(await checkOutByIsbnAction({ studentId: student.id, isbn: code, dueOn }))}
        status={
          lastItem && !lastItem.undone ? (
            <p className="text-center text-title-md">
              Checked out {lastItem.title}
              <span className="block text-body-md text-on-surface-variant">
                {session.filter((item) => !item.undone).length} so far for {student.firstName}
              </span>
            </p>
          ) : notice ? (
            <p className="text-center text-body-lg text-error">{notice.message}</p>
          ) : undefined
        }
      />
    </>
  );
}
