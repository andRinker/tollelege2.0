import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { schoolYearLabel, todayInTimeZone } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";
import { getClassRoster, listClasses, type RosterStudent } from "@/server/roster";
import { assertClassInScope, listClassCoTeachers } from "@/server/coteaching";
import { requireClassroom } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { Avatar, EmptyState, PageHeader } from "@/ui/components/expressive";
import { List, ListItem } from "@/ui/components/list";
import { iconArrowBack, iconGroups } from "@/ui/icons/generated";
import { RosterActions } from "../classes-actions";
import { CoTeachersPanel, CoTeachingNote } from "../coteachers-panel";
import { StudentActions } from "../student-actions";

export const metadata: Metadata = { title: "Class" };

function loanSummary(student: RosterStudent) {
  if (student.booksOut === 0) return "No books out";
  const books = `${student.booksOut} ${student.booksOut === 1 ? "book" : "books"} out`;
  return student.overdue > 0 ? (
    <>
      {books} · <span className="text-error">{student.overdue} overdue</span>
    </>
  ) : (
    books
  );
}

export default async function ClassPage({ params }: PageProps<"/classes/[classId]">) {
  const classroom = await requireClassroom();
  const { teacherId, classIds } = classroom;
  const { classId } = await params;
  if (!z.uuid().safeParse(classId).success) notFound();

  const db = getDb();
  // A class not shared with a co-teacher is simply not there, same as one that doesn't exist.
  await assertClassInScope(db, classroom, classId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const [roster, allClasses, sharing] = await Promise.all([
    getClassRoster(db, teacherId, classId, today).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listClasses(db, teacherId, today, classIds),
    classroom.isOwner ? listClassCoTeachers(db, teacherId, classId) : null,
  ]);

  const { class: klass, students } = roster;
  const active = students.filter((student) => student.active);
  const inactive = students.filter((student) => !student.active);
  const classOptions = allClasses.filter((option) => !option.archivedAt || option.id === klass.id).map(({ id, name }) => ({ id, name }));

  const renderStudent = (student: RosterStudent) => {
    const fullName = `${student.firstName} ${student.lastName}`.trim();
    return (
      <ListItem
        key={student.id}
        leading={<Avatar name={fullName} />}
        headline={fullName}
        supporting={loanSummary(student)}
        trailing={student.studentNumber ? <span className="tabular-nums">#{student.studentNumber}</span> : undefined}
        href={`/students/${student.id}`}
        actions={
          <StudentActions student={{ ...student, classId: klass.id }} classes={classOptions} variant="menu" canDelete={classroom.isOwner} />
        }
      />
    );
  };

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href="/classes" variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            Classes
          </LinkButton>
        }
        title={klass.name}
        subtitle={`${klass.schoolYear} · ${active.length} ${active.length === 1 ? "student" : "students"}${klass.archivedAt ? " · Archived" : ""}`}
        actions={
          <RosterActions
            klass={{ id: klass.id, name: klass.name, schoolYear: klass.schoolYear, archived: Boolean(klass.archivedAt) }}
            studentCount={students.length}
            defaultSchoolYear={schoolYearLabel(today)}
            classes={classOptions}
            canManageClass={classroom.isOwner}
          />
        }
      />

      <div className="pb-6">
        {sharing ? (
          <CoTeachersPanel classId={klass.id} className={klass.name} coTeachers={sharing.coTeachers} invites={sharing.invites} />
        ) : (
          <CoTeachingNote classId={klass.id} className={klass.name} ownerName={classroom.ownerName} />
        )}
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={iconGroups}
          shape="flower"
          title="No students yet"
          description="Use Import to paste names from a list or spreadsheet, or add students one at a time."
        />
      ) : (
        <div className="flex flex-col gap-8">
          <List aria-label="Students">{active.map(renderStudent)}</List>
          {inactive.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-title-lg-em text-on-surface-variant">Inactive</h2>
              <p className="text-body-md text-on-surface-variant">Inactive students keep their history but don&rsquo;t appear when checking out.</p>
              <List aria-label="Inactive students">{inactive.map(renderStudent)}</List>
            </section>
          )}
        </div>
      )}
    </>
  );
}
