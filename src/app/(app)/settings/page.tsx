import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { getLibraryHealth, lastReconcile } from "@/server/reconcile";
import { requireTeacher } from "@/server/session";
import { tidyConfigured } from "@/server/tidy";
import { getRequestSettings } from "@/server/theme";
import { PageHeader } from "@/ui/components/expressive";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };
// "Tidy my library" asks Gemini about a batch of books in one request, which can take a minute.
export const maxDuration = 120;

export default async function SettingsPage() {
  const teacher = await requireTeacher();
  const settings = await getRequestSettings();
  const last = await lastReconcile(getDb(), teacher.teacherId);
  const health = await getLibraryHealth(getDb(), teacher.teacherId, settings.readingLevelSystem !== "none");
  const timeZones = Intl.supportedValuesOf("timeZone");

  return (
    <>
      <PageHeader title="Settings" subtitle="Changes save as you make them." />
      <SettingsForm settings={settings} teacher={{ name: teacher.name, email: teacher.email }} timeZones={timeZones} tidyAvailable={tidyConfigured()} health={health} lastSettle={last && { batchId: last.batchId, books: last.books }} />
    </>
  );
}
