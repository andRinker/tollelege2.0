import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isGoogleSignInEnabled } from "@/lib/auth";
import { getSession } from "@/server/session";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getSession()) redirect("/dashboard");
  return <SignUpForm googleEnabled={isGoogleSignInEnabled} />;
}
