"use client";

import { type ReactNode, useState } from "react";
import { Form } from "react-aria-components";
import { authClient } from "@/lib/auth-client";
import { BrandMark } from "@/ui/components/brand";
import { Button } from "@/ui/components/button";
import { Icon } from "@/ui/components/icon";
import { IconButton } from "@/ui/components/icon-button";
import { TextField } from "@/ui/components/text-field";
import { iconError, iconVisibility, iconVisibilityOff } from "@/ui/icons/generated";

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-3">
      <BrandMark className="text-primary expanded:hidden" />
      <h1 className="text-headline-lg-em text-on-surface">{title}</h1>
      {subtitle && <p className="text-body-lg text-on-surface-variant">{subtitle}</p>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
      <Icon icon={iconError} size={20} className="mt-px" />
      <p>{message}</p>
    </div>
  );
}

export function PasswordField({
  label = "Password",
  name = "password",
  autoComplete,
  description,
}: {
  label?: string;
  name?: string;
  autoComplete: "current-password" | "new-password";
  description?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      name={name}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      isRequired
      minLength={autoComplete === "new-password" ? 8 : undefined}
      description={description}
      trailing={
        <IconButton
          icon={visible ? iconVisibilityOff : iconVisibility}
          label={visible ? "Hide password" : "Show password"}
          tooltip={false}
          onPress={() => setVisible((value) => !value)}
        />
      }
    />
  );
}

export function GoogleButton({ callbackURL, label = "Continue with Google" }: { callbackURL: string; label?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outlined"
      size="md"
      className="w-full"
      isPending={pending}
      onPress={async () => {
        setPending(true);
        const { error } = await authClient.signIn.social({ provider: "google", callbackURL });
        if (error) setPending(false);
      }}
    >
      <span className="flex items-center gap-3">
        <GoogleLogo />
        {label}
      </span>
    </Button>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width={20} height={20} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-label-md text-on-surface-variant">
      <span className="h-px grow bg-outline-variant" />
      {children}
      <span className="h-px grow bg-outline-variant" />
    </div>
  );
}

/** Wraps a form so the submit handler receives its values and inputs keep native validation. */
export function AuthForm({ onSubmit, children }: { onSubmit: (data: FormData) => void; children: ReactNode }) {
  return (
    <Form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
    </Form>
  );
}
