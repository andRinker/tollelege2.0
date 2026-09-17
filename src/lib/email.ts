import { APP_NAME } from "@/lib/brand";

type PasswordResetEmail = { to: string; name: string; url: string };

export async function sendPasswordResetEmail({ to, name, url }: PasswordResetEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("RESEND_API_KEY is not set, so the password reset email was not sent.");
    } else {
      console.info(`\n[dev] Password reset link for ${to}:\n${url}\n`);
    }
    return;
  }

  const greeting = name ? `Hi ${name},` : "Hi,";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || `${APP_NAME} <onboarding@resend.dev>`,
      to: [to],
      subject: `Reset your ${APP_NAME} password`,
      text: `${greeting}\n\nUse this link to choose a new password:\n${url}\n\nIf you didn't ask to reset your password, you can ignore this email.`,
      html: `<p>${escapeHtml(greeting)}</p><p><a href="${escapeHtml(url)}">Choose a new password</a></p><p>If you didn't ask to reset your password, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    console.error(`Resend rejected the password reset email (${response.status}): ${await response.text()}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
