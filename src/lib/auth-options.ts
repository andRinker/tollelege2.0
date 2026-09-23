/**
 * How sign-ins attach to accounts. Its own module so the integration test that proves a
 * colleague's pre-built account is claimed on first Google sign-in runs against exactly
 * these settings, not a copy of them.
 *
 * Google is trusted, so a first Google sign-in with an email that already has an account
 * links to that account instead of making a new one. Better Auth only does that when the
 * existing account's email is verified, which is why an admin-created account is created
 * verified: see `createColleagueAccount`.
 */
export const accountOptions = {
  accountLinking: { enabled: true, trustedProviders: ["google"] },
};
