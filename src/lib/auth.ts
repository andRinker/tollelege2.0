import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { APP_NAME } from "@/lib/brand";
import { sendPasswordResetEmail } from "@/lib/email";

export const isGoogleSignInEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

/** The public origin of this deployment. Also what a QR code has to point a phone at. */
export function resolveBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  // Production uses its stable domain, so links and the Google redirect URI never point at a one-off deployment URL.
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Preview and production hosts that Vercel assigns to a deployment. */
function vercelOrigins(): string[] {
  return [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .filter((host): host is string => Boolean(host))
    .map((host) => `https://${host}`);
}

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL: resolveBaseUrl(),
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: vercelOrigins(),
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Not awaited, so response timing doesn't reveal whether the email exists.
      waitUntil(sendPasswordResetEmail({ to: user.email, name: user.name, url }));
    },
  },
  socialProviders: isGoogleSignInEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          prompt: "select_account",
        },
      }
    : {},
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  // Must stay last: it copies Set-Cookie headers into Next.js server actions.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
