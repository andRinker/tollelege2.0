import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { availabilityText } from "@/components/availability";
import { BookCover } from "@/components/book-cover";
import { READING_LEVEL_FIELD_LABELS } from "@/components/book-form";
import { getDb } from "@/db/client";
import type { CopyStatus } from "@/db/schema/enums";
import { describeDueDate, formatInstant, isOverdue, todayInTimeZone } from "@/lib/dates";
import { formatIsbn13 } from "@/lib/isbn";
import { catalogSummary, getBookDetail } from "@/server/catalog";
import { NotFoundError } from "@/server/errors";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { cx } from "@/ui/cx";
import { LinkButton } from "@/ui/components/button";
import { Avatar, PageHeader, Shape } from "@/ui/components/expressive";
import { List, ListItem } from "@/ui/components/list";
import { iconArrowBack } from "@/ui/icons/generated";
import { AddCopyButton, BookActions, CopyMenu } from "./book-actions";

export const metadata: Metadata = { title: "Book" };

const STATUS_LABELS: Record<Exclude<CopyStatus, "in_circulation">, string> = {
  lost: "Lost",
  damaged: "Damaged",
  withdrawn: "Withdrawn",
};

export default async function BookPage({ params }: PageProps<"/library/[bookId]">) {
  const { teacherId } = await requireTeacher();
  const { bookId } = await params;
  if (!z.uuid().safeParse(bookId).success) notFound();

  const db = getDb();
  const detail = await getBookDetail(db, teacherId, bookId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [settings, summary] = await Promise.all([getRequestSettings(), catalogSummary(db, teacherId)]);
  const today = todayInTimeZone(settings.timeZone);
  const { book, copies, history } = detail;

  const inCirculation = copies.filter((copy) => copy.status === "in_circulation");
  const available = inCirculation.filter((copy) => !copy.loanId).length;
  const facts = [
    book.isbn13 && { label: "ISBN", value: formatIsbn13(book.isbn13) },
    book.publisher && { label: "Publisher", value: book.publisher },
    book.publishedYear && { label: "Published", value: String(book.publishedYear) },
    book.pageCount && { label: "Pages", value: String(book.pageCount) },
    book.readingLevel && { label: READING_LEVEL_FIELD_LABELS[settings.readingLevelSystem], value: book.readingLevel },
    book.location && { label: "Bin or shelf", value: book.location },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href="/library" variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            Library
          </LinkButton>
        }
        title={book.title}
        subtitle={[book.subtitle, book.authors.join(", ")].filter(Boolean).join(" · ") || undefined}
        actions={
          <BookActions
            book={book}
            readingLevelSystem={settings.readingLevelSystem}
            suggestions={{ tags: summary.tags, locations: summary.locations }}
          />
        }
      />

      <div className="grid gap-6 expanded:grid-cols-[260px_minmax(0,1fr)] expanded:items-start">
        <aside className="flex flex-col gap-4 max-expanded:grid max-expanded:grid-cols-[120px_minmax(0,1fr)] max-expanded:items-center medium:max-expanded:grid-cols-[180px_minmax(0,1fr)]">
          <BookCover title={book.title} coverUrl={book.coverUrl} size="lg" className="rounded-lg shadow-2" />
          <div className="relative flex flex-col gap-1 overflow-hidden rounded-xl bg-primary-container p-5 text-on-primary-container">
            <span aria-hidden="true" className="absolute -top-6 -right-6">
              <Shape shape="cookie9" size={110} className="fill-primary/10" />
            </span>
            <span className="relative text-display-md-em tabular-nums" style={{ fontVariationSettings: '"ROND" 100' }}>
              {available}
              <span className="text-headline-sm text-on-primary-container/70">/{inCirculation.length}</span>
            </span>
            <span className="relative text-title-md">{availabilityText(available, inCirculation.length)}</span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {(facts.length > 0 || book.tags.length > 0 || book.description || book.notes) && (
            <section className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-5 medium:p-6">
              {facts.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 medium:grid-cols-3">
                  {facts.map((fact) => (
                    <div key={fact.label} className="flex flex-col">
                      <dt className="text-label-md text-on-surface-variant">{fact.label}</dt>
                      <dd className="text-body-lg whitespace-nowrap tabular-nums max-medium:text-body-md">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {book.tags.length > 0 && (
                <ul aria-label="Tags" className="flex flex-wrap gap-2">
                  {book.tags.map((tag) => (
                    <li key={tag}>
                      <LinkButton href={`/library?tag=${encodeURIComponent(tag)}`} variant="outlined" size="xs" shape="square">
                        {tag}
                      </LinkButton>
                    </li>
                  ))}
                </ul>
              )}
              {book.description && <p className="max-w-prose text-body-lg text-on-surface-variant">{book.description}</p>}
              {book.notes && (
                <div className="rounded-lg bg-tertiary-container px-4 py-3 text-body-md text-on-tertiary-container">
                  <span className="text-label-lg-em">Your notes: </span>
                  {book.notes}
                </div>
              )}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-title-lg-em">Copies</h2>
              <AddCopyButton bookId={book.id} />
            </div>
            <List aria-label="Copies">
              {copies.map((copy) => {
                const studentName = copy.studentFirstName ? `${copy.studentFirstName} ${copy.studentLastName}`.trim() : null;
                const overdue = isOverdue(copy.dueOn, today);
                const supporting =
                  copy.status !== "in_circulation"
                    ? STATUS_LABELS[copy.status]
                    : copy.loanId
                      ? `${studentName} · ${copy.dueOn ? describeDueDate(copy.dueOn, today) : `since ${formatInstant(copy.checkedOutAt as Date, settings.timeZone, today)}`}`
                      : "Available";
                return (
                  <ListItem
                    key={copy.id}
                    leading={
                      <Shape
                        shape={copy.loanId ? "clover4" : copy.status === "in_circulation" ? "cookie9" : "square"}
                        size={40}
                        className={
                          copy.status !== "in_circulation"
                            ? "fill-surface-container-highest"
                            : copy.loanId
                              ? overdue
                                ? "fill-error-container"
                                : "fill-tertiary-container"
                              : "fill-primary-container"
                        }
                      >
                        <span className="text-label-lg-em text-on-surface">{copy.copyNumber}</span>
                      </Shape>
                    }
                    headline={`Copy ${copy.copyNumber}`}
                    supporting={<span className={cx(overdue && copy.loanId && "text-error")}>{supporting}</span>}
                    href={copy.studentId ? `/students/${copy.studentId}` : undefined}
                    actions={
                      <CopyMenu
                        bookId={book.id}
                        copyId={copy.id}
                        copyNumber={copy.copyNumber}
                        status={copy.status}
                        isCheckedOut={Boolean(copy.loanId)}
                        canDelete={copy.loanCount === 0 && copies.length > 1}
                      />
                    }
                  />
                );
              })}
            </List>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-title-lg-em">Checkout history</h2>
            {history.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
                <span className="text-on-surface-variant" aria-hidden="true">
                  <Shape shape="sunny" size={32} className="fill-secondary-container" />
                </span>
                No one has checked out this book yet.
              </div>
            ) : (
              <List aria-label="Checkout history">
                {history.map((loan) => {
                  const name = `${loan.studentFirstName} ${loan.studentLastName}`.trim();
                  const out = formatInstant(loan.checkedOutAt, settings.timeZone, today);
                  const supporting = loan.closedAt
                    ? `${out} – ${formatInstant(loan.closedAt, settings.timeZone, today)}${loan.closeReason === "lost" ? " · Lost" : ""} · Copy ${loan.copyNumber}`
                    : `Checked out ${out}${loan.dueOn ? ` · ${describeDueDate(loan.dueOn, today)}` : ""} · Copy ${loan.copyNumber}`;
                  return (
                    <ListItem
                      key={loan.loanId}
                      leading={<Avatar name={name} />}
                      headline={name}
                      supporting={supporting}
                      trailing={!loan.closedAt ? <span className="text-label-md text-tertiary">Out now</span> : undefined}
                      href={`/students/${loan.studentId}`}
                    />
                  );
                })}
              </List>
            )}
            {history.length >= 50 && (
              <p className="text-body-sm text-on-surface-variant">Showing the 50 most recent checkouts.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
