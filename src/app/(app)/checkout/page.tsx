import type { Metadata } from "next";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { findStudents, listClasses } from "@/server/roster";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { EmptyState, PageHeader } from "@/ui/components/expressive";
import { iconGroupAdd, iconGroups } from "@/ui/icons/generated";
import { CheckoutFlow } from "./checkout-flow";

export const metadata: Metadata = { title: "Check out" };

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const { teacherId } = await requireTeacher();
  const { student } = await searchParams;
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const db = getDb();
  const [students, classes] = await Promise.all([findStudents(db, teacherId, { today }), listClasses(db, teacherId, today)]);
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
      defaultDueOn={settings.loanPeriodDays ? addDays(today, settings.loanPeriodDays) : null}
      maxBooksPerStudent={settings.maxBooksPerStudent}
      initialStudentId={initialStudentId}
    />
  );
}
