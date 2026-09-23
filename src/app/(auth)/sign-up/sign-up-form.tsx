"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ui/components/button";
import { TextField } from "@/ui/components/text-field";
import { TextLink } from "@/ui/components/text-link";
import { AuthForm, AuthHeading, Divider, FormError, GoogleButton, PasswordField } from "../auth-form";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signUp(data: FormData) {
    setPending(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({
      name: String(data.get("name")).trim(),
      email: String(data.get("email")).trim(),
      password: String(data.get("password")),
    });
    if (signUpError) {
      setError(
        signUpError.code === "USER_ALREADY_EXISTS" || signUpError.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
          ? // Also what a colleague sees whose account an admin made for them, and which has no password yet.
            "An account with that email already exists. Sign in instead, with Google, or use “Forgot password?” to set a password."
          : (signUpError.message ?? "We couldn't create your account. Try again."),
      );
      setPending(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <>
      <AuthHeading title="Create your account" subtitle="Set up your classroom library in a few minutes." />
      <div className="flex flex-col gap-6">
        {googleEnabled && (
          <>
            <GoogleButton callbackURL="/dashboard" label="Sign up with Google" />
            <Divider>or</Divider>
          </>
        )}
        <AuthForm onSubmit={signUp}>
          <FormError message={error} />
          <TextField label="Your name" name="name" autoComplete="name" isRequired autoFocus description="Shown only to you" />
          <TextField label="School email" name="email" type="email" autoComplete="email" isRequired />
          <PasswordField autoComplete="new-password" description="At least 8 characters" />
          <Button type="submit" size="md" className="w-full" isPending={pending}>
            Create account
          </Button>
        </AuthForm>
        <p className="text-center text-body-md text-on-surface-variant">
          Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
        </p>
      </div>
    </>
  );
}
