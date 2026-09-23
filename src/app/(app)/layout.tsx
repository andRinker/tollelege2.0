import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { lendingAttentionCount } from "@/server/lending";
import { currentUserIsAdmin } from "@/server/admin";
import { getActingAdmin, requireTeacher } from "@/server/session";
import { rememberTimeZone } from "@/server/settings";
import { getRequestSettings } from "@/server/theme";
import { AppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const teacher = await requireTeacher();
  const [settings, cookieStore] = await Promise.all([getRequestSettings(), cookies()]);

  const [lendingWaiting, isAdmin, acting] = await Promise.all([
    lendingAttentionCount(getDb(), teacher.teacherId),
    currentUserIsAdmin(),
    getActingAdmin(),
  ]);

  // The root layout's inline script stores the browser time zone; save it once. Not while
  // an admin is acting as this teacher, though: that's the admin's browser, not theirs.
  const rawBrowserTimeZone = cookieStore.get("tz")?.value;
  const browserTimeZone = rawBrowserTimeZone ? decodeURIComponent(rawBrowserTimeZone) : null;
  if (!settings.timeZone && browserTimeZone && !acting) {
    await rememberTimeZone(getDb(), teacher.teacherId, browserTimeZone);
  }

  return (
    <AppShell
      teacher={{ name: teacher.name, email: teacher.email }}
      railExpanded={cookieStore.get("rail")?.value === "expanded"}
      lendingWaiting={lendingWaiting}
      isAdmin={isAdmin}
      // Formatted here, in the teacher's zone, so the server and browser render the same time.
      actingUntil={
        acting
          ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: settings.timeZone ?? browserTimeZone ?? "UTC" }).format(
              acting.expiresAt,
            )
          : null
      }
    >
      {children}
    </AppShell>
  );
}
