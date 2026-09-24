import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { lendingAttentionCount } from "@/server/lending";
import { currentUserIsAdmin } from "@/server/admin";
import { claimCoTeacherInvites, listSharedClassrooms } from "@/server/coteaching";
import { claimHandovers } from "@/server/handover";
import { getActingAdmin, getSession, requireClassroom, requireTeacher } from "@/server/session";
import { rememberTimeZone } from "@/server/settings";
import { getRequestSettings } from "@/server/theme";
import { AppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const teacher = await requireTeacher();
  const [settings, cookieStore, session] = await Promise.all([getRequestSettings(), cookies(), getSession()]);

  // Someone invited to co-teach, or offered a hand-over, before they had an account gets
  // it here, the first time they're signed in with that email verified.
  if (session) await Promise.all([claimCoTeacherInvites(getDb(), session.user), claimHandovers(getDb(), session.user)]);

  const [lendingWaiting, isAdmin, acting, classroom, sharedClassrooms] = await Promise.all([
    lendingAttentionCount(getDb(), teacher.teacherId),
    currentUserIsAdmin(),
    getActingAdmin(),
    requireClassroom(),
    listSharedClassrooms(getDb(), teacher.teacherId),
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
      classrooms={sharedClassrooms.map(({ ownerId, ownerName, classes }) => ({
        ownerId,
        ownerName,
        classNames: classes.map((klass) => klass.name),
      }))}
      currentClassroom={classroom.isOwner ? null : classroom.teacherId}
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
