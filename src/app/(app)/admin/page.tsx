import type { Metadata } from "next";
import { StatCard } from "@/components/stat-card";
import { getDb } from "@/db/client";
import { formatRecentInstant, todayInTimeZone } from "@/lib/dates";
import { listAdminAudit, listTeacherAccounts, requireAdmin, systemHealth } from "@/server/admin";
import { getRequestSettings } from "@/server/theme";
import { PageHeader } from "@/ui/components/expressive";
import { List, ListItem } from "@/ui/components/list";
import { Avatar } from "@/ui/components/expressive";
import { AuditList } from "./audit-list";

export const metadata: Metadata = { title: "Admin" };

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export default async function AdminPage() {
  await requireAdmin();
  const db = getDb();
  const [settings, health, accounts, audit] = await Promise.all([
    getRequestSettings(),
    systemHealth(db),
    listTeacherAccounts(db),
    listAdminAudit(db, { limit: 20 }),
  ]);
  const today = todayInTimeZone(settings.timeZone);

  return (
    <>
      <PageHeader title="Admin" subtitle={`${plural(health.accounts, "account")} · ${health.activeThisWeek} active this week`} />

      <section aria-labelledby="system-heading" className="flex flex-col gap-3 pb-8">
        <h2 id="system-heading" className="text-title-lg-em">
          System
        </h2>
        <div className="grid grid-cols-2 gap-3 medium:grid-cols-4">
          <StatCard
            value={health.accounts}
            label="Accounts"
            detail={`${health.verifiedAccounts} with a verified email`}
            shape="cookie9"
            tone="primary"
          />
          <StatCard
            value={health.pendingLendingRequests}
            label="Lending requests waiting"
            detail={`${plural(health.activeShelfLoans, "book")} on loan · ${plural(health.pendingConnections, "invitation")} pending`}
            shape="clover4"
            tone="secondary"
          />
          <StatCard
            value={health.activePairings}
            label="Phones paired now"
            detail={`${plural(health.phoneScansThisWeek, "scan")} and ${plural(health.phoneShelfPhotosThisWeek, "shelf photo")} from phones this week`}
            shape="sunny"
            tone="tertiary"
          />
          <StatCard
            value={health.lookupCacheFound}
            label="Books in the lookup cache"
            detail={`${plural(health.lookupCacheMissing, "ISBN")} no catalogue knew`}
            shape="softBurst"
            tone="secondary"
          />
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Shelf photos taken on a laptop aren&rsquo;t recorded anywhere, so only phone ones are counted.
        </p>
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-3 pb-8">
        <h2 id="accounts-heading" className="text-title-lg-em">
          Accounts
        </h2>
        <List aria-label="Accounts">
          {accounts.map((account) => (
            <ListItem
              key={account.id}
              href={`/admin/teachers/${account.id}`}
              leading={<Avatar name={account.name} />}
              headline={account.name}
              supporting={
                <span className="flex flex-col">
                  <span className="truncate">
                    {account.email}
                    {!account.emailVerified && " · unverified"}
                  </span>
                  <span className="truncate">
                    {`${plural(account.titles, "title")} · ${plural(account.students, "student")} · ${plural(account.checkouts, "checkout")}`}
                  </span>
                </span>
              }
              trailing={
                <span className="tabular-nums">
                  {account.lastActiveAt ? formatRecentInstant(account.lastActiveAt, settings.timeZone, today) : "Signed out"}
                </span>
              }
            />
          ))}
        </List>
      </section>

      <section aria-labelledby="audit-heading" className="flex flex-col gap-3">
        <h2 id="audit-heading" className="text-title-lg-em">
          Admin activity
        </h2>
        <AuditList entries={audit} timeZone={settings.timeZone} today={today} />
      </section>
    </>
  );
}
