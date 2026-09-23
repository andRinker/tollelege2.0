import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { accountOptions } from "@/lib/auth-options";
import { createBook } from "@/server/catalog";
import { ConflictError } from "@/server/errors";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

vi.mock("@/server/session", () => ({ getSession: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
const { createColleagueAccount, getTeacherAccount, listAdminAudit } = await import("@/server/admin");

/**
 * Runs the same Better Auth routine the Google callback uses to attach a Google sign-in to
 * an account, with the app's own linking settings, against a real database. Google itself
 * can't be reached from a test, but everything after it returns a verified profile can.
 */
function authFor(db: Database) {
  return betterAuth({
    secret: "test-only-secret-0123456789-0123456789",
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders: { google: { clientId: "test", clientSecret: "test" } },
    account: accountOptions,
    plugins: [
      {
        id: "test-google-sign-in",
        endpoints: {
          testGoogleSignIn: createAuthEndpoint(
            "/test/google-sign-in",
            { method: "POST", body: z.object({ email: z.string(), googleId: z.string() }) },
            async (ctx) => {
              const result = await handleOAuthUserInfo(ctx, {
                userInfo: { id: ctx.body.googleId, email: ctx.body.email, emailVerified: true, name: "From Google" },
                account: { providerId: "google", accountId: ctx.body.googleId },
              });
              return ctx.json({ error: result.error, userId: result.data?.user.id ?? null });
            },
          ),
        },
      },
    ],
  });
}

describe("an account created for a colleague", () => {
  let testDb: TestDatabase;
  let db: Database;
  let admin: { adminId: string; name: string; email: string };

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    const adminId = await createTeacher(db, "Andrew Rinker", "arinker@augprep.org");
    admin = { adminId, name: "Andrew Rinker", email: "arinker@augprep.org" };
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("is theirs, library and all, the first time they sign in with Google", async () => {
    const { id } = await createColleagueAccount(db, admin, { name: "Joan Sparks", email: "JSparks@AugPrep.org " });
    await createBook(db, id, {
      isbn13: null, title: "Hatchet", subtitle: null, authors: [], description: null, coverUrl: null, publisher: null,
      publishedYear: null, pageCount: null, readingLevel: null, tags: [], location: null, notes: null, metadataSource: "manual",
    });
    expect(await getTeacherAccount(db, id)).toMatchObject({ email: "jsparks@augprep.org", hasSignedIn: false, titles: 1 });

    // The admin building it, acting as her, isn't her being active.
    await db.insert(schema.session).values({
      id: "acting", token: "acting-token", userId: id, impersonatedBy: admin.adminId,
      expiresAt: new Date(Date.now() + 3_600_000), updatedAt: new Date(),
    });
    expect((await getTeacherAccount(db, id)).lastActiveAt).toBeNull();

    const result = await authFor(db).api.testGoogleSignIn({ body: { email: "jsparks@augprep.org", googleId: "g-joan" } });

    // Linked to the prepared account, not a new empty one.
    expect(result).toEqual({ error: null, userId: id });
    expect(await db.select().from(schema.user).where(eq(schema.user.email, "jsparks@augprep.org"))).toHaveLength(1);
    expect(await getTeacherAccount(db, id)).toMatchObject({ hasSignedIn: true, titles: 1 });
  });

  it("would be refused if it weren't created verified, which is why it is", async () => {
    // The control: the same sign-in against an account whose email isn't verified.
    const id = await createTeacher(db, "Unverified", "unverified@augprep.org");
    await db.update(schema.user).set({ emailVerified: false }).where(eq(schema.user.id, id));
    const result = await authFor(db).api.testGoogleSignIn({ body: { email: "unverified@augprep.org", googleId: "g-x" } });
    expect(result).toEqual({ error: "account not linked", userId: null });
  });

  it("is refused for an email that already has an account, or belongs to an admin", async () => {
    await expect(createColleagueAccount(db, admin, { name: "Twice", email: "jsparks@augprep.org" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    vi.stubEnv("ADMIN_EMAILS", "arinker@augprep.org,second-admin@augprep.org");
    await expect(
      createColleagueAccount(db, admin, { name: "Admin", email: "Second-Admin@augprep.org" }),
    ).rejects.toThrow("admin's address");
    vi.unstubAllEnvs();
  });

  it("is recorded in the admin log", async () => {
    const { id } = await createColleagueAccount(db, admin, { name: "Kim Lee", email: "klee@augprep.org" });
    expect(await listAdminAudit(db, { targetTeacherId: id })).toMatchObject([
      { action: "created_account", adminEmail: "arinker@augprep.org", targetEmail: "klee@augprep.org" },
    ]);
  });
});
