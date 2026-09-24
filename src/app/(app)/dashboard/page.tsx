import type { Metadata } from "next";
import { BookCover } from "@/components/book-cover";
import { LoanActions } from "@/components/loan-actions";
import { StatCard } from "@/components/stat-card";
import { getDb } from "@/db/client";
import { describeDueDate, formatRecentInstant, hourInTimeZone, todayInTimeZone } from "@/lib/dates";
import { catalogSummary } from "@/server/catalog";
import { type ActivityItem, circulationStats, listOpenLoans, recentActivity } from "@/server/circulation";
import { pendingHandoversTo } from "@/server/handover";
import { rosterCounts } from "@/server/roster";
import { requireClassroom, requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { cx } from "@/ui/cx";
import { HandoverOffers } from "./handover-offers";
import { LinkButton } from "@/ui/components/button";
import { PageHeader, Shape } from "@/ui/components/expressive";
import { Icon } from "@/ui/components/icon";
import { List, ListItem } from "@/ui/components/list";
import type { IconData } from "@/ui/icons/generated";
import {
  iconArrowForward,
  iconCheckCircle,
  iconGroupAdd,
  iconInput,
  iconLibraryAdd,
  iconOutput,
  iconReport,
} from "@/ui/icons/generated";

export const metadata: Metadata = { title: "Home" };

const OVERDUE_PREVIEW = 5;
// Large buttons keep their height on tablets but trade side padding so three fit in a row.
const QUICK_ACTION = "w-full max-expanded:[--btn-pad:16px]!";

function greeting(hour: number) {
  if (hour < 5) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const ACTIVITY: Record<ActivityItem["kind"], { icon: IconData; describe: (student: string) => string; className: string }> = {
  checked_out: { icon: iconOutput, describe: (student) => `Checked out to ${student}`, className: "text-primary" },
  returned: { icon: iconInput, describe: (student) => `Returned by ${student}`, className: "text-tertiary" },
  lost: { icon: iconReport, describe: (student) => `Marked lost from ${student}`, className: "text-error" },
};

export default async function DashboardPage() {
  const teacher = await requireTeacher();
  // In a classroom you co-teach, everything here is its owner's, limited to the shared classes.
  const classroom = await requireClassroom();
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const db = getDb();
  const { teacherId, classIds } = classroom;
  const [stats, catalog, roster, overdueLoans, activity, offers] = await Promise.all([
    circulationStats(db, teacherId, today, settings.timeZone ?? "UTC", classIds),
    catalogSummary(db, teacherId),
    rosterCounts(db, teacherId, classIds),
    listOpenLoans(db, teacherId, { today, overdueOnly: true, limit: OVERDUE_PREVIEW, classIds }),
    recentActivity(db, teacherId, 8, classIds),
    // Offered to the signed-in teacher's own account, whichever classroom they're in.
    pendingHandoversTo(db, teacher.teacherId),
  ]);

  const firstName = teacher.name.split(/\s+/)[0];
  const setupSteps = [
    { done: catalog.titles > 0, label: "Add your books", detail: "Scan barcodes or type ISBNs to fill your catalog.", action: "Add books", href: "/library/add", icon: iconLibraryAdd },
    { done: roster.students > 0, label: "Set up a class", detail: "Paste your roster or upload a CSV.", action: "Go to Classes", href: "/classes", icon: iconGroupAdd },
    { done: activity.length > 0, label: "Check out a book", detail: "Pick a student, then scan the book.", action: "Check out", href: "/checkout", icon: iconOutput },
  ];
  // Setting a classroom up is its owner's job, not something to nag a co-teacher about.
  const settingUp = classroom.isOwner && setupSteps.some((step) => !step.done);
  const hasLibrary = catalog.titles > 0 || roster.students > 0;

  const summary =
    catalog.titles === 0
      ? "Let's get your classroom library set up."
      : stats.booksOut === 0
        ? "Every book is on the shelf."
        : [
            `${plural(stats.booksOut, "book", "books")} out`,
            stats.overdue > 0 && `${stats.overdue} overdue`,
            stats.dueToday > 0 && `${stats.dueToday} due today`,
          ]
            .filter(Boolean)
            .join(" · ");

  return (
    <>
      <PageHeader title={`${greeting(hourInTimeZone(settings.timeZone))}, ${firstName}`} subtitle={summary} />

      <div className="flex flex-col gap-8 pb-8">
        {offers.length > 0 && (
          <HandoverOffers
            offers={offers.map(({ id, fromName, classNames, books }) => ({ id, fromName, classNames, books }))}
          />
        )}
        {settingUp && (
          <section aria-labelledby="get-started" className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-4 medium:p-6">
            <h2 id="get-started" className="text-title-lg-em">
              Get started
            </h2>
            <ol className="grid grid-cols-1 gap-3 expanded:grid-cols-3">
              {setupSteps.map((step, index) => (
                <li key={step.href} className="flex items-start gap-4 rounded-lg bg-surface-container p-4">
                  {step.done ? (
                    <Icon icon={iconCheckCircle} filled size={40} className="shrink-0 text-primary" />
                  ) : (
                    <Shape shape="cookie9" size={40} className="fill-secondary-container">
                      <span className="text-title-md-em text-on-secondary-container">{index + 1}</span>
                    </Shape>
                  )}
                  <div className="flex min-w-0 grow flex-col gap-1">
                    <h3 className={cx("text-title-md", step.done && "text-on-surface-variant line-through decoration-1")}>{step.label}</h3>
                    {!step.done && (
                      <>
                        <p className="text-body-md text-on-surface-variant">{step.detail}</p>
                        <LinkButton href={step.href} variant="tonal" size="xs" icon={step.icon} className="mt-2 self-start">
                          {step.action}
                        </LinkButton>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-label="Quick actions" className="grid grid-cols-1 gap-3 medium:grid-cols-3">
          <LinkButton href="/checkout" size="lg" compact shape="square" icon={iconOutput} className={QUICK_ACTION}>
            Check out
          </LinkButton>
          <LinkButton href="/checkin" size="lg" compact shape="square" variant="tonal" icon={iconInput} className={QUICK_ACTION}>
            Check in
          </LinkButton>
          <LinkButton href="/library/add" size="lg" compact shape="square" variant="tonal" icon={iconLibraryAdd} className={QUICK_ACTION}>
            Add books
          </LinkButton>
        </section>

        {hasLibrary && (
          <section aria-label="At a glance" className="grid grid-cols-2 gap-3 expanded:grid-cols-4">
            <StatCard
              value={stats.booksOut}
              label={stats.booksOut === 1 ? "Book out" : "Books out"}
              detail={stats.checkedOutToday > 0 ? `${stats.checkedOutToday} today` : undefined}
              shape="cookie9"
              tone="primary"
              href="/checkin"
            />
            <StatCard
              value={stats.overdue}
              label="Overdue"
              detail={stats.dueToday > 0 ? `${stats.dueToday} due today` : undefined}
              shape="softBurst"
              tone={stats.overdue > 0 ? "error" : "tertiary"}
              href="/checkin?show=overdue"
            />
            <StatCard
              value={catalog.titles}
              label={catalog.titles === 1 ? "Title" : "Titles"}
              detail={plural(catalog.copies, "copy", "copies")}
              shape="clover4"
              tone="secondary"
              href="/library"
            />
            <StatCard
              value={roster.students}
              label={roster.students === 1 ? "Student" : "Students"}
              detail={plural(roster.classes, "class", "classes")}
              shape="sunny"
              tone="secondary"
              href="/classes"
            />
          </section>
        )}

        {activity.length > 0 && (
          <div className="grid grid-cols-1 gap-8 expanded:grid-cols-2 expanded:items-start">
            <section aria-labelledby="overdue" className="flex min-w-0 flex-col gap-3">
              <div className="flex min-h-10 items-center justify-between gap-2">
                <h2 id="overdue" className="text-title-lg-em">
                  Overdue
                </h2>
                {stats.overdue > OVERDUE_PREVIEW && (
                  <LinkButton href="/checkin?show=overdue" variant="text" size="xs" trailingIcon={iconArrowForward}>
                    All {stats.overdue}
                  </LinkButton>
                )}
              </div>
              {overdueLoans.length === 0 ? (
                <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
                  {stats.booksOut === 0 ? "Nothing is checked out." : "Nothing is overdue."}
                </p>
              ) : (
                <List aria-label="Overdue books">
                  {overdueLoans.map((loan) => (
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
                          <span className="text-error">{loan.dueOn && describeDueDate(loan.dueOn, today)}</span>
                        </>
                      }
                      href={`/students/${loan.studentId}`}
                      actions={<LoanActions loanId={loan.loanId} title={loan.title} studentName={loan.studentName} />}
                    />
                  ))}
                </List>
              )}
            </section>

            <section aria-labelledby="activity" className="flex min-w-0 flex-col gap-3">
              <div className="flex min-h-10 items-center">
                <h2 id="activity" className="text-title-lg-em">
                  Recent activity
                </h2>
              </div>
              {activity.length === 0 ? (
                <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
                  Checkouts and returns will show up here.
                </p>
              ) : (
                <List aria-label="Recent activity">
                  {activity.map((item) => {
                    const kind = ACTIVITY[item.kind];
                    return (
                      <ListItem
                        key={`${item.loanId}-${item.kind}`}
                        leading={
                          <div className="w-10">
                            <BookCover title={item.title} coverUrl={item.coverUrl} size="sm" className="rounded-xs" />
                          </div>
                        }
                        headline={item.title}
                        supporting={
                          <span className="flex items-center gap-1.5">
                            <Icon icon={kind.icon} size={16} className={cx("shrink-0", kind.className)} />
                            <span className="truncate">{kind.describe(item.studentName)}</span>
                          </span>
                        }
                        trailing={<span className="tabular-nums">{formatRecentInstant(item.at, settings.timeZone, today)}</span>}
                        href={item.bookId ? `/library/${item.bookId}` : undefined}
                      />
                    );
                  })}
                </List>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
