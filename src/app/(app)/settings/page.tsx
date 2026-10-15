import type { Metadata } from "next";
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
  const timeZones = Intl.supportedValuesOf("timeZone");

  return (
    <>
      <PageHeader title="Settings" subtitle="Changes save as you make them." />
      <SettingsForm settings={settings} teacher={{ name: teacher.name, email: teacher.email }} timeZones={timeZones} tidyAvailable={tidyConfigured()} />
    </>
  );
}
