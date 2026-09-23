import type { adminAudit } from "@/db/schema";
import type { AdminAction } from "@/db/schema/enums";
import { formatRecentInstant } from "@/lib/dates";
import { List, ListItem } from "@/ui/components/list";

const DESCRIBE: Record<AdminAction, string> = {
  viewed_account: "Looked inside",
  started_acting: "Started acting as",
  stopped_acting: "Stopped acting as",
  signed_out: "Signed out everywhere:",
  deleted_account: "Deleted the account of",
};

/** The audit trail, newest first. Emails are the ones recorded at the time, so a deleted account still reads. */
export function AuditList({
  entries,
  timeZone,
  today,
}: {
  entries: (typeof adminAudit.$inferSelect)[];
  timeZone: string | null;
  today: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
        Nothing yet. Every look inside an account, and everything done to one, is listed here.
      </p>
    );
  }
  return (
    <List aria-label="Admin activity">
      {entries.map((entry) => (
        <ListItem
          key={entry.id}
          headline={`${DESCRIBE[entry.action]} ${entry.targetEmail}`}
          supporting={`By ${entry.adminEmail}`}
          trailing={<span className="tabular-nums">{formatRecentInstant(entry.at, timeZone, today)}</span>}
        />
      ))}
    </List>
  );
}
