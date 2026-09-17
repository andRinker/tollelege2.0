import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isGoogleSignInEnabled } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSession } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(typeof next === "string" ? next : undefined);
  if (await getSession()) redirect(destination);
  return <SignInForm next={destination} googleEnabled={isGoogleSignInEnabled} />;
}
