import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Availability } from "@/components/availability";
import { getDb } from "@/db/client";
import { formatRecentInstant, todayInTimeZone } from "@/lib/dates";
import { isAdmin, listAdminAudit, listTeacherStudents, openTeacherAccount, requireAdmin } from "@/server/admin";
import { listBooks } from "@/server/catalog";
import { listOpenLoans, recentActivity } from "@/server/circulation";
import { NotFoundError } from "@/server/errors";
import { getRequestSettings } from "@/server/theme";
import { PageHeader } from "@/ui/components/expressive";
import { List, ListItem } from "@/ui/components/list";
import { AuditList } from "../../audit-list";
import { AccountActions } from "./account-actions";

export const metadata: Metadata = { title: "Account" };

/** How many titles the read-only view lists. Acting as the teacher shows the whole library. */
const TITLE_LIMIT = 200;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 pb-8">
      <h2 className="text-title-lg-em">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">{children}</p>;
}

export default async function AdminAccountPage({ params }: PageProps<"/admin/teachers/[teacherId]">) {
  const admin = await requireAdmin();
  const { teacherId } = await params;
  const db = getDb();
  // Opening the page is looking inside the account, so this is where it's recorded.
  const account = await openTeacherAccount(db, admin, teacherId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const [library, roster, out, activity, audit] = await Promise.all([
    listBooks(db, account.id, { pageSize: TITLE_LIMIT }),
    listTeacherStudents(db, account.id),
    listOpenLoans(db, account.id, { today }),
    recentActivity(db, account.id, 10),
    listAdminAudit(db, { targetTeacherId: account.id, limit: 10 }),
  ]);
  const isProtected = account.id === admin.adminId || isAdmin(account);

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={`${account.email}${account.emailVerified ? "" : " (unverified)"} · joined ${formatRecentInstant(account.createdAt, settings.timeZone, today)}`}
      />

      <div className="flex flex-col gap-3 pb-8">
        <AccountActions teacherId={account.id} name={account.name} email={account.email} isProtected={isProtected} />
        <p className="text-body-sm text-on-surface-variant">
          {isProtected
            ? "This is an admin account, so it can't be acted as or deleted from here."
            : "This view is read-only. To add or change anything, act as them: you'll use the same screens they do, for up to an hour."}{" "}
          Opening this page was recorded in the admin activity log.
        </p>
      </div>

      <Section title={`Library · ${plural(account.titles, "title")}, ${plural(account.copies, "copy", "copies")}`}>
        {library.items.length === 0 ? (
          <Empty>No books yet.</Empty>
        ) : (
          <>
            <List aria-label="Their library">
              {library.items.map((book) => (
                <ListItem
                  key={book.id}
                  headline={book.title}
                  supporting={
                    <span className="flex flex-col">
                      {book.authors.length > 0 && <span className="truncate">{book.authors.join(", ")}</span>}
                      <Availability available={book.availableCopies} total={book.totalCopies} />
                    </span>
                  }
                  trailing={book.lendable ? undefined : "Not lent"}
                />
              ))}
            </List>
            {library.total > library.items.length && (
              <p className="text-body-sm text-on-surface-variant">{`Showing the first ${library.items.length} of ${library.total}.`}</p>
            )}
          </>
        )}
      </Section>

      <Section title={`Students · ${account.students}`}>
        {roster.length === 0 ? (
          <Empty>No students yet.</Empty>
        ) : (
          <List aria-label="Their students">
            {roster.map((student) => (
              <ListItem
                key={student.id}
                headline={`${student.firstName} ${student.lastName}`.trim()}
                supporting={[student.className ?? "No class", student.studentNumber, !student.active && "Inactive"]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title={`Checked out now · ${out.length}`}>
        {out.length === 0 ? (
          <Empty>Everything is on the shelf.</Empty>
        ) : (
          <List aria-label="Their books checked out now">
            {out.map((loan) => (
              <ListItem
                key={loan.loanId}
                headline={loan.title}
                supporting={`${loan.studentName}${loan.overdue ? " · overdue" : ""}`}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Recent activity">
        {activity.length === 0 ? (
          <Empty>No checkouts yet.</Empty>
        ) : (
          <List aria-label="Their recent activity">
            {activity.map((item) => (
              <ListItem
                key={`${item.loanId}-${item.kind}`}
                headline={item.title}
                supporting={`${item.kind === "checked_out" ? "Checked out to" : item.kind === "lost" ? "Lost by" : "Returned by"} ${item.studentName}`}
                trailing={<span className="tabular-nums">{formatRecentInstant(item.at, settings.timeZone, today)}</span>}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Admin activity on this account">
        <AuditList entries={audit} timeZone={settings.timeZone} today={today} />
      </Section>
    </>
  );
}
