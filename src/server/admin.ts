import "server-only";
import { and, count, desc, eq, gt, gte, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import type { Database } from "@/db/client";
import {
  type AdminAction,
  adminAudit,
  books,
  classes,
  copies,
  isbnLookupCache,
  loans,
  scanEvents,
  scanSessions,
  session,
  shelfLoans,
  students,
  teacherConnections,
  user,
} from "@/db/schema";
import { isAdmin } from "@/lib/admin-access";
import { ConflictError, NotFoundError } from "./errors";
import { revokeAllPairings } from "./scan-pairing";
import { getSession } from "./session";

/*
 * The admin is the one role allowed across teacher lines, so everything it can do lives
 * here, behind `requireAdmin()`. These functions deliberately take a *target* teacher ID
 * from the URL rather than from the session: that is exactly what an admin is for, and
 * why nothing outside this file may do it. Every look inside an account and every action
 * on one is written to `admin_audit`.
 */

export { adminEmails, isAdmin } from "@/lib/admin-access";

export type Admin = { adminId: string; name: string; email: string };

/** Whether this request's user is an admin, for deciding what to show. Never a gate. */
export async function currentUserIsAdmin(): Promise<boolean> {
  const current = await getSession();
  return Boolean(current && isAdmin(current.user));
}

/**
 * Gate for every admin page and action. A non-admin gets a 404 rather than a 403, so the
 * admin area doesn't announce that it exists.
 */
export async function requireAdmin(): Promise<Admin> {
  const current = await getSession();
  if (!current) redirect("/sign-in");
  if (!isAdmin(current.user)) notFound();
  return { adminId: current.user.id, name: current.user.name, email: current.user.email };
}

async function audit(db: Database, admin: Admin, action: AdminAction, target: { id: string; email: string }) {
  await db.insert(adminAudit).values({
    adminId: admin.adminId,
    adminEmail: admin.email,
    action,
    targetTeacherId: target.id,
    targetEmail: target.email,
  });
}

/** Per-teacher counts, as grouped subqueries joined by teacher, so the names stay qualified. */
function usageSubqueries(db: Database) {
  const titleCounts = db
    .select({ teacherId: books.teacherId, titles: count().as("titles") })
    .from(books)
    .groupBy(books.teacherId)
    .as("title_counts");
  const copyCounts = db
    .select({ teacherId: copies.teacherId, copies: count().as("copies") })
    .from(copies)
    .groupBy(copies.teacherId)
    .as("copy_counts");
  const studentCounts = db
    .select({ teacherId: students.teacherId, students: count().as("students") })
    .from(students)
    .groupBy(students.teacherId)
    .as("student_counts");
  const classCounts = db
    .select({ teacherId: classes.teacherId, classes: count().as("classes") })
    .from(classes)
    .groupBy(classes.teacherId)
    .as("class_counts");
  const loanCounts = db
    .select({
      teacherId: loans.teacherId,
      checkouts: count().as("checkouts"),
      out: sql<number>`count(*) filter (where ${loans.closedAt} is null)`.mapWith(Number).as("out"),
    })
    .from(loans)
    .groupBy(loans.teacherId)
    .as("loan_counts");
  const lastSeen = db
    .select({ userId: session.userId, lastActiveAt: max(session.updatedAt).as("last_active_at") })
    .from(session)
    .groupBy(session.userId)
    .as("last_seen");
  return { titleCounts, copyCounts, studentCounts, classCounts, loanCounts, lastSeen };
}

export type TeacherAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  /** The last time any of their sessions was used or refreshed. Null once they've signed out everywhere. */
  lastActiveAt: Date | null;
  titles: number;
  copies: number;
  classes: number;
  students: number;
  checkouts: number;
  out: number;
};

async function selectAccounts(db: Database, where?: ReturnType<typeof eq>): Promise<TeacherAccount[]> {
  const q = usageSubqueries(db);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastActiveAt: q.lastSeen.lastActiveAt,
      titles: sql<number>`coalesce(${q.titleCounts.titles}, 0)`.mapWith(Number),
      copies: sql<number>`coalesce(${q.copyCounts.copies}, 0)`.mapWith(Number),
      classes: sql<number>`coalesce(${q.classCounts.classes}, 0)`.mapWith(Number),
      students: sql<number>`coalesce(${q.studentCounts.students}, 0)`.mapWith(Number),
      checkouts: sql<number>`coalesce(${q.loanCounts.checkouts}, 0)`.mapWith(Number),
      out: sql<number>`coalesce(${q.loanCounts.out}, 0)`.mapWith(Number),
    })
    .from(user)
    .leftJoin(q.titleCounts, eq(q.titleCounts.teacherId, user.id))
    .leftJoin(q.copyCounts, eq(q.copyCounts.teacherId, user.id))
    .leftJoin(q.classCounts, eq(q.classCounts.teacherId, user.id))
    .leftJoin(q.studentCounts, eq(q.studentCounts.teacherId, user.id))
    .leftJoin(q.loanCounts, eq(q.loanCounts.teacherId, user.id))
    .leftJoin(q.lastSeen, eq(q.lastSeen.userId, user.id))
    .where(where)
    .orderBy(desc(user.createdAt));
  return rows.map((row) => ({ ...row, lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt) : null }));
}

/** Every account, newest first, with counts only: nothing from inside a library. */
export async function listTeacherAccounts(db: Database): Promise<TeacherAccount[]> {
  return selectAccounts(db);
}

export async function getTeacherAccount(db: Database, teacherId: string): Promise<TeacherAccount> {
  const [account] = await selectAccounts(db, eq(user.id, teacherId));
  if (!account) throw new NotFoundError("That account doesn't exist.");
  return account;
}

/**
 * Loads an account for an admin to look inside, and records that they did. The caller
 * then reads the library with the ordinary per-teacher functions.
 */
export async function openTeacherAccount(db: Database, admin: Admin, teacherId: string): Promise<TeacherAccount> {
  const account = await getTeacherAccount(db, teacherId);
  // An admin looking at their own account isn't looking inside anyone else's.
  if (account.id !== admin.adminId) await audit(db, admin, "viewed_account", account);
  return account;
}

/** Students across every class, for the read-only view. Names and optional IDs only, as ever. */
export async function listTeacherStudents(db: Database, teacherId: string) {
  return db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      studentNumber: students.studentNumber,
      active: students.active,
      className: classes.name,
    })
    .from(students)
    .leftJoin(classes, eq(classes.id, students.classId))
    .where(eq(students.teacherId, teacherId))
    .orderBy(classes.name, students.lastName, students.firstName);
}

/**
 * Ends every session the teacher has and revokes their phone pairings, as signing out
 * does. A browser may keep working for up to five minutes on its cached session cookie.
 */
export async function signOutTeacher(db: Database, admin: Admin, teacherId: string): Promise<void> {
  const account = await getTeacherAccount(db, teacherId);
  await db.transaction(async (tx) => {
    await tx.delete(session).where(eq(session.userId, account.id));
    await revokeAllPairings(tx, account.id);
    await audit(tx, admin, "signed_out", account);
  });
}

/**
 * Deletes an account and everything in it: library, classes, students, checkout history,
 * connections and pairings all go with the user row. Refused for the admin's own account,
 * and while a book is away on loan in either direction, since the other teacher would be
 * left holding a copy with no owner or waiting on one that no longer exists.
 */
export async function deleteTeacherAccount(
  db: Database,
  admin: Admin,
  teacherId: string,
  confirmEmail: string,
): Promise<{ email: string }> {
  const account = await getTeacherAccount(db, teacherId);
  if (account.id === admin.adminId) throw new ConflictError("You can't delete your own account from here.");
  if (confirmEmail.trim().toLowerCase() !== account.email.toLowerCase()) {
    throw new ConflictError("Type the account's email exactly to confirm.");
  }
  await db.transaction(async (tx) => {
    const [away] = await tx
      .select({ id: shelfLoans.id })
      .from(shelfLoans)
      .where(
        and(
          eq(shelfLoans.status, "active"),
          or(eq(shelfLoans.ownerTeacherId, account.id), eq(shelfLoans.borrowerTeacherId, account.id)),
        ),
      )
      .limit(1);
    if (away) {
      throw new ConflictError("This teacher has a book lent to or from another teacher. It has to be returned first.");
    }
    await audit(tx, admin, "deleted_account", account);
    await tx.delete(user).where(eq(user.id, account.id));
  });
  return { email: account.email };
}

export type SystemHealth = {
  accounts: number;
  verifiedAccounts: number;
  activeThisWeek: number;
  pendingConnections: number;
  pendingLendingRequests: number;
  activeShelfLoans: number;
  activePairings: number;
  phoneShelfPhotosThisWeek: number;
  phoneScansThisWeek: number;
  lookupCacheFound: number;
  lookupCacheMissing: number;
};

export async function systemHealth(db: Database, now = new Date()): Promise<SystemHealth> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [[accounts], [active], [connections], [lending], [pairings], [phone], [cache]] = await Promise.all([
    db
      .select({
        total: count(),
        verified: sql<number>`count(*) filter (where ${user.emailVerified})`.mapWith(Number),
      })
      .from(user),
    db
      .select({ users: sql<number>`count(distinct ${session.userId})`.mapWith(Number) })
      .from(session)
      .where(gte(session.updatedAt, weekAgo)),
    db.select({ pending: count() }).from(teacherConnections).where(eq(teacherConnections.status, "pending")),
    db
      .select({
        requested: sql<number>`count(*) filter (where ${shelfLoans.status} = 'requested')`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${shelfLoans.status} = 'active')`.mapWith(Number),
      })
      .from(shelfLoans),
    db
      .select({ active: count() })
      .from(scanSessions)
      .where(and(isNull(scanSessions.revokedAt), gt(scanSessions.expiresAt, now))),
    db
      .select({
        shelves: sql<number>`count(*) filter (where ${scanEvents.kind} = 'shelf_proposed')`.mapWith(Number),
        scans: sql<number>`count(*) filter (where ${scanEvents.kind} <> 'shelf_proposed')`.mapWith(Number),
      })
      .from(scanEvents)
      .where(gte(scanEvents.createdAt, weekAgo)),
    db
      .select({
        found: sql<number>`count(*) filter (where ${isbnLookupCache.payload} is not null)`.mapWith(Number),
        missing: sql<number>`count(*) filter (where ${isbnLookupCache.payload} is null)`.mapWith(Number),
      })
      .from(isbnLookupCache),
  ]);
  return {
    accounts: accounts.total,
    verifiedAccounts: accounts.verified,
    activeThisWeek: active.users,
    pendingConnections: connections.pending,
    pendingLendingRequests: lending.requested,
    activeShelfLoans: lending.active,
    activePairings: pairings.active,
    phoneShelfPhotosThisWeek: phone.shelves,
    phoneScansThisWeek: phone.scans,
    lookupCacheFound: cache.found,
    lookupCacheMissing: cache.missing,
  };
}

export async function listAdminAudit(db: Database, options: { targetTeacherId?: string; limit?: number } = {}) {
  return db
    .select()
    .from(adminAudit)
    .where(options.targetTeacherId ? eq(adminAudit.targetTeacherId, options.targetTeacherId) : isNotNull(adminAudit.id))
    .orderBy(desc(adminAudit.at))
    .limit(options.limit ?? 30);
}
