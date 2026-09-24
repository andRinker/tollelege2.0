import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { listHandoverChoices, pendingHandoverFrom } from "@/server/handover";
import { requireTeacher } from "@/server/session";
import { PageHeader } from "@/ui/components/expressive";
import { LinkButton } from "@/ui/components/button";
import { iconArrowBack } from "@/ui/icons/generated";
import { HandoverForm, PendingHandover } from "./handover-form";

export const metadata: Metadata = { title: "Hand over" };

export default async function HandoverPage() {
  // Always the teacher's own account, whichever classroom they're working in.
  const { teacherId } = await requireTeacher();
  const db = getDb();
  const pending = await pendingHandoverFrom(db, teacherId);

  return (
    <>
      <PageHeader
        leading={
          <LinkButton href="/settings" variant="text" size="xs" icon={iconArrowBack} className="-ml-3 self-start">
            Settings
          </LinkButton>
        }
        title="Hand over"
        subtitle="Give classes and books to another teacher: for a new school year, a colleague taking over, or a library you built for someone else."
      />
      {pending ? <PendingHandover offer={pending} /> : <HandoverForm choices={await listHandoverChoices(db, teacherId)} />}
    </>
  );
}
