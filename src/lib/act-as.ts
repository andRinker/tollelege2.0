import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "better-auth/cookies";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type AdminAction, adminAudit, scanSessions } from "@/db/schema";
import { isAdmin } from "@/lib/admin-access";

/** How long an admin can act as a teacher before the session lapses on its own. */
export const ACT_AS_MINUTES = 60;

async function audit(admin: { id: string; email: string }, action: AdminAction, target: { id: string; email: string }) {
  await getDb().insert(adminAudit).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action,
    targetTeacherId: target.id,
    targetEmail: target.email,
  });
}

/**
 * Lets an admin work inside a teacher's account, so building or fixing someone's library
 * uses the same screens the teacher would, rather than a second set of admin-only ones.
 *
 * Better Auth's own admin plugin does this too, but it brings a role column and a dozen
 * more endpoints keyed to it (banning, setting roles, creating users). This is just the
 * two endpoints, gated by `ADMIN_EMAILS` like the rest of the admin area. The mechanics
 * are the same: a fresh session for the teacher, marked `impersonatedBy`, with the admin's
 * own session token kept in a signed cookie to put back on stop.
 *
 * `requireTeacher()` returns the teacher while it lasts, which is the point: every page
 * and action works unchanged, and tenant isolation holds, because the admin is simply in
 * that one account. Starting and stopping are audited; edits in between are the teacher's.
 */
export function actAs(): BetterAuthPlugin {
  return {
    id: "act-as",
    schema: {
      session: { fields: { impersonatedBy: { type: "string", required: false } } },
    },
    endpoints: {
      startActingAs: createAuthEndpoint(
        "/act-as/start",
        { method: "POST", body: z.object({ userId: z.string().min(1) }) },
        async (ctx) => {
          const current = await getSessionFromCtx(ctx);
          if (!current) throw APIError.fromStatus("UNAUTHORIZED");
          if ((current.session as { impersonatedBy?: string | null }).impersonatedBy) {
            throw APIError.fromStatus("BAD_REQUEST", { message: "Stop acting as the current teacher first." });
          }
          if (!isAdmin(current.user)) throw APIError.fromStatus("NOT_FOUND");

          const target = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!target) throw APIError.fromStatus("NOT_FOUND", { message: "That account doesn't exist." });
          if (target.id === current.user.id) {
            throw APIError.fromStatus("BAD_REQUEST", { message: "That's your own account." });
          }
          // One admin can't borrow another's powers by acting as them.
          if (isAdmin(target)) throw APIError.fromStatus("FORBIDDEN", { message: "You can't act as another admin." });

          const session = await ctx.context.internalAdapter.createSession(
            target.id,
            true,
            { impersonatedBy: current.user.id, expiresAt: new Date(Date.now() + ACT_AS_MINUTES * 60_000) },
            true,
          );
          if (!session) throw APIError.fromStatus("INTERNAL_SERVER_ERROR");

          const dontRemember = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
          const adminCookie = ctx.context.createAuthCookie("admin_session");
          deleteSessionCookie(ctx);
          await ctx.setSignedCookie(
            adminCookie.name,
            `${current.session.token}:${dontRemember || ""}`,
            ctx.context.secret,
            ctx.context.authCookies.sessionToken.attributes,
          );
          await setSessionCookie(ctx, { session, user: target }, true);
          await audit(current.user, "started_acting", target);
          return ctx.json({ ok: true });
        },
      ),

      stopActingAs: createAuthEndpoint("/act-as/stop", { method: "POST", requireHeaders: true }, async (ctx) => {
        const current = await getSessionFromCtx(ctx);
        const impersonatedBy = (current?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy;
        if (!current || !impersonatedBy) {
          throw APIError.fromStatus("BAD_REQUEST", { message: "You aren't acting as anyone." });
        }

        const adminCookie = ctx.context.createAuthCookie("admin_session");
        const stored = await ctx.getSignedCookie(adminCookie.name, ctx.context.secret);
        const [adminToken, dontRemember] = (typeof stored === "string" ? stored : "").split(":");
        const adminSession = adminToken ? await ctx.context.internalAdapter.findSession(adminToken) : null;
        if (!adminSession || adminSession.session.userId !== impersonatedBy) {
          // Without the admin's own session there's nothing to go back to, so end this one and sign in again.
          await ctx.context.internalAdapter.deleteSession(current.session.token);
          deleteSessionCookie(ctx);
          expireCookie(ctx, adminCookie);
          throw APIError.fromStatus("UNAUTHORIZED", { message: "Sign in again to get back to your own account." });
        }

        // A phone paired while acting would otherwise keep adding to their library until midnight.
        await getDb()
          .update(scanSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(scanSessions.teacherId, current.user.id), gte(scanSessions.createdAt, current.session.createdAt)));

        await ctx.context.internalAdapter.deleteSession(current.session.token);
        await setSessionCookie(ctx, adminSession, !!dontRemember);
        expireCookie(ctx, adminCookie);
        await audit(adminSession.user, "stopped_acting", current.user);
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}
