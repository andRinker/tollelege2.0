import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { todayInTimeZone } from "@/lib/dates";
import { listOpenLoans } from "@/server/circulation";
import { requireClassroom } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { CheckinFlow } from "./checkin-flow";

export const metadata: Metadata = { title: "Check in" };

export default async function CheckinPage({ searchParams }: PageProps<"/checkin">) {
  const { teacherId, classIds } = await requireClassroom();
  const { show } = await searchParams;
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const loans = await listOpenLoans(getDb(), teacherId, { today, classIds });
  return <CheckinFlow loans={loans} today={today} timeZone={settings.timeZone} initialFilter={show === "overdue" ? "overdue" : "all"} />;
}
