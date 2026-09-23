import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";

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
