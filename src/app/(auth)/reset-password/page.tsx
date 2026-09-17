"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, LinkButton } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/expressive";
import { iconCheckCircle, iconError } from "@/ui/icons/generated";
import { AuthForm, AuthHeading, FormError, PasswordField } from "../auth-form";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || params.get("error")) {
    return (
      <EmptyState
        icon={iconError}
        shape="softBurst"
        title="This link has expired"
        description="Reset links work once and only for a short time. Request a new one."
        action={<LinkButton variant="tonal" href="/forgot-password">Get a new link</LinkButton>}
      />
    );
  }

  if (done) {
    return (
      <EmptyState
        icon={iconCheckCircle}
        shape="cookie9"
        title="Password updated"
        description="You can sign in with your new password."
        action={<LinkButton href="/sign-in">Sign in</LinkButton>}
      />
    );
  }

  return (
    <>
      <AuthHeading title="Choose a new password" />
      <AuthForm
        onSubmit={async (data) => {
          const newPassword = String(data.get("password"));
          if (newPassword !== String(data.get("confirm"))) {
            setError("The passwords don't match.");
            return;
          }
          setPending(true);
          setError(null);
          const { error: resetError } = await authClient.resetPassword({ newPassword, token });
          setPending(false);
          if (resetError) setError(resetError.message ?? "We couldn't update your password. Request a new link.");
          else setDone(true);
        }}
      >
        <FormError message={error} />
        <PasswordField autoComplete="new-password" label="New password" description="At least 8 characters" />
        <PasswordField autoComplete="new-password" label="Confirm new password" name="confirm" />
        <Button type="submit" size="md" className="w-full" isPending={pending}>
          Update password
        </Button>
      </AuthForm>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
