import type { Metadata } from "next";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { findStudents, listClasses } from "@/server/roster";
import { requireClassroom } from "@/server/session";
import { getTeacherSettings } from "@/server/settings";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { EmptyState, PageHeader } from "@/ui/components/expressive";
import { iconGroupAdd, iconGroups } from "@/ui/icons/generated";
import { CheckoutFlow } from "./checkout-flow";

export const metadata: Metadata = { title: "Check out" };

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const { teacherId, classIds } = await requireClassroom();
  const { student } = await searchParams;
  const db = getDb();
  // Your own display settings; the classroom owner's circulation rules (loan period, limit).
  const [settings, rules] = await Promise.all([getRequestSettings(), getTeacherSettings(db, teacherId)]);
  const today = todayInTimeZone(settings.timeZone);
  const [students, classes] = await Promise.all([
    findStudents(db, teacherId, { today, classIds }),
    listClasses(db, teacherId, today, classIds),
  ]);
  const initialStudentId = typeof student === "string" && z.uuid().safeParse(student).success ? student : null;

  if (students.length === 0) {
    return (
      <>
        <PageHeader title="Check out" />
        <EmptyState
          icon={iconGroups}
          shape="clover4"
          title="Add students first"
          description="Checkouts are recorded to students on your class rosters."
          action={
            <LinkButton href="/classes" icon={iconGroupAdd} size="md">
              Set up a class
            </LinkButton>
          }
        />
      </>
    );
  }

  return (
    <CheckoutFlow
      students={students}
      classes={classes.filter((klass) => !klass.archivedAt).map(({ id, name }) => ({ id, name }))}
      today={today}
      defaultDueOn={rules.loanPeriodDays ? addDays(today, rules.loanPeriodDays) : null}
      maxBooksPerStudent={rules.maxBooksPerStudent}
      initialStudentId={initialStudentId}
    />
  );
}
