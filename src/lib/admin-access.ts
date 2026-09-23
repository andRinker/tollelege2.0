/**
 * Who counts as an admin. Pure, and free of server imports, because the auth config
 * needs it too and the server's admin module already depends on the auth config.
 */

/** `ADMIN_EMAILS`, comma-separated, compared case-insensitively. Empty means no admins. */
export function adminEmails(raw = process.env.ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Only a *verified* address counts. Password sign-ups here are never verified, so without
 * this anyone could register an admin's address before they did and walk in as admin.
 * Google sign-ins are verified by Google.
 */
export function isAdmin(account: { email: string; emailVerified: boolean }, raw = process.env.ADMIN_EMAILS): boolean {
  return account.emailVerified && adminEmails(raw).has(account.email.toLowerCase());
}
