import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { requireTeacher } from "@/server/session";
import { rememberTimeZone } from "@/server/settings";
import { getRequestSettings } from "@/server/theme";
import { AppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const teacher = await requireTeacher();
  const [settings, cookieStore] = await Promise.all([getRequestSettings(), cookies()]);

  // The root layout's inline script stores the browser time zone; save it once.
  const browserTimeZone = cookieStore.get("tz")?.value;
  if (!settings.timeZone && browserTimeZone) {
    await rememberTimeZone(getDb(), teacher.teacherId, decodeURIComponent(browserTimeZone));
  }

  return (
    <AppShell teacher={{ name: teacher.name, email: teacher.email }} railExpanded={cookieStore.get("rail")?.value === "expanded"}>
      {children}
    </AppShell>
  );
}
