import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { auth } from "@/lib/auth";
import { type Classroom, resolveClassroom } from "./coteaching";

export type Teacher = {
  teacherId: string;
  name: string;
  email: string;
  image: string | null;
};

/** The verified session for this request, or null. Deduplicated per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/**
 * The only source of a teacher ID for data access. Redirects to sign-in when the
 * request has no valid session. Call it in every page, layout, and server action.
 */
export async function requireTeacher(): Promise<Teacher> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return {
    teacherId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
  };
}

/**
 * When an admin is working inside this account through "Act as": who, and until when.
 * Null for an ordinary session. See `src/lib/act-as.ts`.
 */
export async function getActingAdmin(): Promise<{ adminId: string; expiresAt: Date } | null> {
  const session = await getSession();
  const adminId = (session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy;
  return session && adminId ? { adminId, expiresAt: new Date(session.session.expiresAt) } : null;
}

/** Which classroom this browser is working in: an owner's user ID, or unset for your own. */
export const CLASSROOM_COOKIE = "classroom";

/**
 * The classroom for this request: your own, or one you co-teach in if you've switched to
 * it. The cookie only *asks*; `resolveClassroom` checks it against the grants and falls
 * back to your own classroom for anything you can't reach.
 *
 * Only pages and actions written for co-teaching call this. Everything else keeps calling
 * `requireTeacher()`, and so keeps working in the teacher's own account whatever the
 * cookie says. That's what keeps a new screen closed to co-teachers until someone decides
 * what they may see on it.
 */
export const requireClassroom = cache(async (): Promise<Classroom> => {
  const teacher = await requireTeacher();
  const cookieStore = await cookies();
  return resolveClassroom(getDb(), teacher, cookieStore.get(CLASSROOM_COOKIE)?.value);
});
