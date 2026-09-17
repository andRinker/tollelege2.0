import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { todayInTimeZone } from "@/lib/dates";
import { listOpenLoans } from "@/server/circulation";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { CheckinFlow } from "./checkin-flow";

export const metadata: Metadata = { title: "Check in" };

export default async function CheckinPage() {
  const { teacherId } = await requireTeacher();
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const loans = await listOpenLoans(getDb(), teacherId, { today });
  return <CheckinFlow loans={loans} today={today} timeZone={settings.timeZone} />;
}
