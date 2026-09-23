import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { adminAudit, books, classes, loans, scanSessions, session, students, user } from "@/db/schema";
import { adminEmails, isAdmin } from "@/lib/admin-access";
import { createBook } from "@/server/catalog";
import { listConnections, requestConnection, respondToConnection } from "@/server/connections";
import { ConflictError, NotFoundError } from "@/server/errors";
import { approveShelfLoan, requestShelfLoan } from "@/server/lending";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

// The request-bound gate (`requireAdmin`) needs a Next.js request; everything else here
// is plain data access and is tested against a real database.
vi.mock("@/server/session", () => ({ getSession: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const {
  deleteTeacherAccount,
  getTeacherAccount,
  listAdminAudit,
  listTeacherAccounts,
  openTeacherAccount,
  signOutTeacher,
  systemHealth,
} = await import("@/server/admin");

describe("who counts as an admin", () => {
  it("reads a comma-separated list, ignoring case and spaces", () => {
    expect([...adminEmails(" ARinker@augprep.org , second@school.test,,")]).toEqual([
      "arinker@augprep.org",
      "second@school.test",
    ]);
    expect(adminEmails(undefined).size).toBe(0);
  });

  it("needs a verified address, so an admin's email can't be claimed by signing up with it", () => {
    const list = "arinker@augprep.org";
    expect(isAdmin({ email: "ARinker@augprep.org", emailVerified: true }, list)).toBe(true);
    expect(isAdmin({ email: "arinker@augprep.org", emailVerified: false }, list)).toBe(false);
    expect(isAdmin({ email: "someone@augprep.org", emailVerified: true }, list)).toBe(false);
    expect(isAdmin({ email: "arinker@augprep.org", emailVerified: true }, "")).toBe(false);
  });
});

describe("admin", () => {
  let testDb: TestDatabase;
  let db: Database;
  let adminId: string;
  let admin: { adminId: string; name: string; email: string };

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    adminId = await createTeacher(db, "Andrew Rinker", "arinker@augprep.org");
    admin = { adminId, name: "Andrew Rinker", email: "arinker@augprep.org" };
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function teacherWithALibrary(name: string, email: string) {
    const id = await createTeacher(db, name, email);
    const { copyIds } = await createBook(db, id, {
      isbn13: null, title: "Hatchet", subtitle: null, authors: ["Gary Paulsen"], description: null, coverUrl: null,
      publisher: null, publishedYear: null, pageCount: null, readingLevel: null, tags: [], location: null, notes: null,
      metadataSource: "manual",
    }, 2);
    const [klass] = await db.insert(classes).values({ teacherId: id, name: "Room 4", schoolYear: "2026–27" }).returning();
    const [ada] = await db.insert(students).values({ teacherId: id, classId: klass.id, firstName: "Ada" }).returning();
    await db.insert(loans).values({ teacherId: id, copyId: copyIds[0], studentId: ada.id, bookTitle: "Hatchet" });
    return id;
  }

  it("lists accounts with counts only", async () => {
    const id = await teacherWithALibrary("Cara Lin", "cara@school.test");
    const cara = (await listTeacherAccounts(db)).find((account) => account.id === id);
    expect(cara).toMatchObject({ email: "cara@school.test", titles: 1, copies: 2, classes: 1, students: 1, checkouts: 1, out: 1 });
    // No sessions yet, so never seen.
    expect(cara?.lastActiveAt).toBeNull();
  });

  it("records a look inside someone else's account, but not inside the admin's own", async () => {
    const id = await teacherWithALibrary("Dev Patel", "dev@school.test");
    await openTeacherAccount(db, admin, id);
    await openTeacherAccount(db, admin, adminId);
    const trail = await listAdminAudit(db);
    expect(trail.filter((entry) => entry.targetTeacherId === id)).toMatchObject([
      { action: "viewed_account", adminEmail: "arinker@augprep.org", targetEmail: "dev@school.test" },
    ]);
    expect(trail.filter((entry) => entry.targetTeacherId === adminId)).toHaveLength(0);
    await expect(openTeacherAccount(db, admin, "no-such-user")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("signs a teacher out everywhere and ends their phone pairings", async () => {
    const id = await teacherWithALibrary("Eli Brooks", "eli@school.test");
    const future = new Date(Date.now() + 3_600_000);
    await db.insert(session).values({ id: "s1", token: "t1", userId: id, expiresAt: future, updatedAt: new Date() });
    await db.insert(scanSessions).values({ teacherId: id, tokenHash: "h".repeat(64), expiresAt: future });

    expect((await getTeacherAccount(db, id)).lastActiveAt).not.toBeNull();
    await signOutTeacher(db, admin, id);

    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0);
    const [pairing] = await db.select().from(scanSessions).where(eq(scanSessions.teacherId, id));
    expect(pairing.revokedAt).not.toBeNull();
    expect((await listAdminAudit(db, { targetTeacherId: id }))[0]).toMatchObject({ action: "signed_out" });
  });

  it("deletes an account and everything in it, and the audit record outlives it", async () => {
    const id = await teacherWithALibrary("Fay Moss", "fay@school.test");

    await expect(deleteTeacherAccount(db, admin, id, "wrong@school.test")).rejects.toBeInstanceOf(ConflictError);
    await deleteTeacherAccount(db, admin, id, " FAY@school.test ");

    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0);
    expect(await db.select().from(books).where(eq(books.teacherId, id))).toHaveLength(0);
    expect(await db.select().from(students).where(eq(students.teacherId, id))).toHaveLength(0);
    expect(await db.select().from(loans).where(eq(loans.teacherId, id))).toHaveLength(0);
    const [record] = await db.select().from(adminAudit).where(eq(adminAudit.targetTeacherId, id));
    expect(record).toMatchObject({ action: "deleted_account", targetEmail: "fay@school.test" });
  });

  it("won't delete the admin's own account", async () => {
    await expect(deleteTeacherAccount(db, admin, adminId, "arinker@augprep.org")).rejects.toThrow("your own account");
  });

  it("won't delete an account while a book is lent to or from another teacher", async () => {
    const owner = await createTeacher(db, "Gia Rossi", "gia@school.test");
    const borrower = await createTeacher(db, "Hal Kim", "hal@school.test");
    await requestConnection(db, owner, "hal@school.test");
    const { incoming } = await listConnections(db, borrower);
    await respondToConnection(db, borrower, incoming[0].connectionId, true);
    const { bookId } = await createBook(db, owner, {
      isbn13: null, title: "Holes", subtitle: null, authors: [], description: null, coverUrl: null, publisher: null,
      publishedYear: null, pageCount: null, readingLevel: null, tags: [], location: null, notes: null, metadataSource: "manual",
    });
    const { shelfLoanId } = await requestShelfLoan(db, borrower, { ownerTeacherId: owner, bookId, message: null });
    await approveShelfLoan(db, owner, shelfLoanId, { dueOn: null });

    await expect(deleteTeacherAccount(db, admin, owner, "gia@school.test")).rejects.toThrow("returned first");
    await expect(deleteTeacherAccount(db, admin, borrower, "hal@school.test")).rejects.toThrow("returned first");
    // Nothing was deleted, and nothing was recorded as deleted.
    expect(await db.select().from(user).where(eq(user.id, owner))).toHaveLength(1);
    expect((await listAdminAudit(db, { targetTeacherId: owner })).some((entry) => entry.action === "deleted_account")).toBe(false);
  });

  it("reports the system at a glance", async () => {
    const health = await systemHealth(db);
    expect(health.accounts).toBeGreaterThanOrEqual(5);
    expect(health.verifiedAccounts).toBe(health.accounts);
    expect(health.activeShelfLoans).toBe(1);
  });
});
