"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, LinkButton } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/expressive";
import { TextField } from "@/ui/components/text-field";
import { TextLink } from "@/ui/components/text-link";
import { iconMail } from "@/ui/icons/generated";
import { AuthForm, AuthHeading, FormError } from "../auth-form";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (sentTo) {
    return (
      <EmptyState
        icon={iconMail}
        shape="sunny"
        title="Check your email"
        description={`If ${sentTo} has an account, we sent it a link to choose a new password.`}
        action={<LinkButton variant="tonal" href="/sign-in">Back to sign in</LinkButton>}
      />
    );
  }

  return (
    <>
      <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send you a reset link." />
      <div className="flex flex-col gap-6">
        <AuthForm
          onSubmit={async (data) => {
            const email = String(data.get("email")).trim();
            setPending(true);
            setError(null);
            const { error: requestError } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
            setPending(false);
            if (requestError) setError(requestError.message ?? "We couldn't send the email. Try again.");
            else setSentTo(email);
          }}
        >
          <FormError message={error} />
          <TextField label="Email" name="email" type="email" autoComplete="email" isRequired autoFocus />
          <Button type="submit" size="md" className="w-full" isPending={pending}>
            Send reset link
          </Button>
        </AuthForm>
        <p className="text-center text-body-md text-on-surface-variant">
          Remembered it? <TextLink href="/sign-in">Sign in</TextLink>
        </p>
      </div>
    </>
  );
}
