"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, LinkButton } from "@/ui/components/button";
import { TextField } from "@/ui/components/text-field";
import { TextLink } from "@/ui/components/text-link";
import { AuthForm, AuthHeading, Divider, FormError, GoogleButton, PasswordField } from "../auth-form";

export function SignInForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(data: FormData) {
    setPending(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: String(data.get("email")),
      password: String(data.get("password")),
    });
    if (signInError) {
      setError(
        signInError.code === "INVALID_EMAIL_OR_PASSWORD"
          ? "That email and password don't match. Check them and try again."
          : (signInError.message ?? "We couldn't sign you in. Try again."),
      );
      setPending(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <AuthHeading title="Welcome back" subtitle="Sign in to your classroom library." />
      <div className="flex flex-col gap-6">
        {googleEnabled && (
          <>
            <GoogleButton callbackURL={next} />
            <Divider>or</Divider>
          </>
        )}
        <AuthForm onSubmit={signIn}>
          <FormError message={error} />
          <TextField label="Email" name="email" type="email" autoComplete="email" isRequired autoFocus />
          <PasswordField autoComplete="current-password" />
          <div className="-mt-2 flex justify-end">
            <LinkButton variant="text" size="sm" href="/forgot-password">
              Forgot password?
            </LinkButton>
          </div>
          <Button type="submit" size="md" className="w-full" isPending={pending}>
            Sign in
          </Button>
        </AuthForm>
        <p className="text-center text-body-md text-on-surface-variant">
          New here? <TextLink href="/sign-up">Create an account</TextLink>
        </p>
      </div>
    </>
  );
}
