import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BookCover } from "@/components/book-cover";
import { LoanActions } from "@/components/loan-actions";
import { StatCard } from "@/components/stat-card";
import { getDb } from "@/db/client";
import { describeDueDate, formatInstant, isOverdue, todayInTimeZone } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";
import { getStudentDetail, listClasses } from "@/server/roster";
import { assertStudentInScope } from "@/server/coteaching";
import { requireClassroom } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { cx } from "@/ui/cx";
import { LinkButton } from "@/ui/components/button";
import { Avatar, PageHeader } from "@/ui/components/expressive";
import { List, ListItem } from "@/ui/components/list";
import { iconArrowBack, iconOutput } from "@/ui/icons/generated";
import { StudentActions } from "../../classes/student-actions";

export const metadata: Metadata = { title: "Student" };

export default async function StudentPage({ params }: PageProps<"/students/[studentId]">) {
  const classroom = await requireClassroom();
  const { teacherId, classIds } = classroom;
  const { studentId } = await params;
  if (!z.uuid().safeParse(studentId).success) notFound();

  const db = getDb();
  // A student outside a co-teacher's shared classes doesn't exist, as far as they can tell.
  await assertStudentInScope(db, classroom, studentId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const [detail, allClasses] = await Promise.all([
    getStudentDetail(db, teacherId, studentId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listClasses(db, teacherId, today, classIds),
  ]);

  const { student, current, history } = detail;
  const fullName = `${student.firstName} ${student.lastName}`.trim();
  const overdueCount = current.filter((loan) => isOverdue(loan.dueOn, today)).length;
  const backHref = student.classId ? `/classes/${student.classId}` : "/classes";
  const classOptions = allClasses.filter((option) => !option.archivedAt || option.id === student.classId).map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href={backHref} variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            {student.className ?? "Classes"}
          </LinkButton>
        }
        title={
          <span className="flex items-center gap-4">
            <Avatar name={fullName} size={56} className="max-medium:hidden" />
            {fullName}
          </span>
        }
        subtitle={[
          student.className ? `${student.className} · ${student.schoolYear}` : "Not in a class",
          student.studentNumber && `ID ${student.studentNumber}`,
          !student.active && "Inactive",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {student.active && (
              <LinkButton href={`/checkout?student=${student.id}`} size="md" compact icon={iconOutput}>
                Check out a book
              </LinkButton>
            )}
            <StudentActions
              student={{ ...student, booksOut: current.length }}
              classes={classOptions}
              variant="page"
              afterDeleteHref={backHref}
              canDelete={classroom.isOwner}
            />
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3 pb-8">
        <StatCard value={current.length} label={current.length === 1 ? "Book out" : "Books out"} shape="cookie9" tone="primary" />
        <StatCard value={overdueCount} label="Overdue" shape="softBurst" tone={overdueCount > 0 ? "error" : "tertiary"} />
        <StatCard value={history.length} label={history.length === 1 ? "Book returned" : "Books returned"} shape="clover4" tone="tertiary" />
      </div>

      <div className="grid grid-cols-1 gap-8 expanded:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-title-lg-em">Checked out now</h2>
          {current.length === 0 ? (
            <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
              {student.firstName} doesn&rsquo;t have any books right now.
            </p>
          ) : (
            <List aria-label="Books checked out now">
              {current.map((loan) => (
                <ListItem
                  key={loan.loanId}
                  leading={
                    <div className="w-10">
                      <BookCover title={loan.title} coverUrl={loan.coverUrl} size="sm" className="rounded-xs" />
                    </div>
                  }
                  headline={loan.title}
                  supporting={
                    <span className={cx(isOverdue(loan.dueOn, today) && "text-error")}>
                      {loan.dueOn ? describeDueDate(loan.dueOn, today) : `Since ${formatInstant(loan.checkedOutAt, settings.timeZone, today)}`} · Copy{" "}
                      {loan.copyNumber}
                    </span>
                  }
                  href={`/library/${loan.bookId}`}
                  actions={<LoanActions loanId={loan.loanId} title={loan.title} studentName={fullName} />}
                />
              ))}
            </List>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-title-lg-em">Reading history</h2>
          {history.length === 0 ? (
            <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
              Returned books will show up here.
            </p>
          ) : (
            <List aria-label="Reading history">
              {history.map((loan) => (
                <ListItem
                  key={loan.loanId}
                  leading={
                    <div className="w-10">
                      <BookCover title={loan.title} coverUrl={loan.coverUrl} size="sm" className="rounded-xs" />
                    </div>
                  }
                  headline={loan.title}
                  supporting={`${formatInstant(loan.checkedOutAt, settings.timeZone, today)} – ${formatInstant(loan.closedAt as Date, settings.timeZone, today)}${loan.closeReason === "lost" ? " · Lost" : ""}`}
                  // A book deleted since stays in the history, but there's no page to open.
                  href={loan.bookId ? `/library/${loan.bookId}` : undefined}
                />
              ))}
            </List>
          )}
        </section>
      </div>
    </>
  );
}
