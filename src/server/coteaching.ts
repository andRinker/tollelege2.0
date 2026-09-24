import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { classes, classTeacherInvites, classTeachers, loans, students, user } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";

/*
 * Co-teaching: a class's owner shares it with another teacher, who then works in it with
 * the owner's books. Nothing moves: everything the co-teacher adds or changes is stored
 * under the owner, exactly as if the owner had done it, so every table keeps its single
 * `teacher_id` and tenant isolation still holds row by row. What changes is *which* rows a
 * co-teacher may reach, and that is decided here and nowhere else.
 */

/**
 * Whose classroom a request is working in, and how far it may reach.
 *
 * `teacherId` is always the owner's, and is what every data function is given: the
 * co-teacher's own ID never reaches a query. `classIds` is the limit on students and
 * checkouts: null for the owner, who sees every class, and the shared classes for a
 * co-teacher. Unassigned students belong to no class, so a co-teacher never sees them.
 */
export type Classroom = {
  teacherId: string;
  actorId: string;
  isOwner: boolean;
  ownerName: string;
  classIds: string[] | null;
};

export function ownClassroom(teacher: { teacherId: string; name: string }): Classroom {
  return { teacherId: teacher.teacherId, actorId: teacher.teacherId, isOwner: true, ownerName: teacher.name, classIds: null };
}

/**
 * The condition that keeps a query inside a classroom's classes, or undefined for the owner.
 * An empty list matches nothing, rather than being dropped and matching everything.
 */
export function inScope(column: PgColumn, classIds: readonly string[] | null | undefined): SQL | undefined {
  if (classIds == null) return undefined;
  if (classIds.length === 0) return sql`false`;
  return inArray(column, [...classIds]);
}

/**
 * The classroom `actor` asked to work in. Anything they can't reach (a stale cookie, a
 * co-teaching grant since removed, someone else's ID typed in) falls back to their own,
 * so the answer is never more than they're allowed.
 */
export async function resolveClassroom(
  db: Database,
  actor: { teacherId: string; name: string },
  requestedOwnerId: string | null | undefined,
): Promise<Classroom> {
  if (!requestedOwnerId || requestedOwnerId === actor.teacherId) return ownClassroom(actor);
  const grants = await db
    .select({ classId: classTeachers.classId, ownerName: user.name })
    .from(classTeachers)
    .innerJoin(user, eq(user.id, classTeachers.ownerTeacherId))
    .where(and(eq(classTeachers.coTeacherId, actor.teacherId), eq(classTeachers.ownerTeacherId, requestedOwnerId)));
  if (grants.length === 0) return ownClassroom(actor);
  return {
    teacherId: requestedOwnerId,
    actorId: actor.teacherId,
    isOwner: false,
    ownerName: grants[0].ownerName,
    classIds: grants.map((grant) => grant.classId),
  };
}

export type SharedClassroom = { ownerId: string; ownerName: string; classes: { id: string; name: string }[] };

/** Every classroom someone co-teaches in, for the switcher. */
export async function listSharedClassrooms(db: Database, coTeacherId: string): Promise<SharedClassroom[]> {
  const rows = await db
    .select({ ownerId: classTeachers.ownerTeacherId, ownerName: user.name, classId: classes.id, className: classes.name })
    .from(classTeachers)
    .innerJoin(classes, eq(classes.id, classTeachers.classId))
    .innerJoin(user, eq(user.id, classTeachers.ownerTeacherId))
    .where(eq(classTeachers.coTeacherId, coTeacherId))
    .orderBy(asc(user.name), asc(sql`lower(${classes.name})`));
  const byOwner = new Map<string, SharedClassroom>();
  for (const row of rows) {
    const room = byOwner.get(row.ownerId) ?? { ownerId: row.ownerId, ownerName: row.ownerName, classes: [] };
    room.classes.push({ id: row.classId, name: row.className });
    byOwner.set(row.ownerId, room);
  }
  return [...byOwner.values()];
}

/** Refuses anything a co-teacher may not do, with the reason they'll see. */
export function assertOwner(classroom: Classroom, action: string): void {
  if (!classroom.isOwner) throw new ForbiddenError(`Only ${classroom.ownerName} can ${action}.`);
}

/** A class the classroom may work in. Same message as a missing class, so nothing is revealed. */
export async function assertClassInScope(db: Database, classroom: Classroom, classId: string): Promise<void> {
  if (classroom.classIds && !classroom.classIds.includes(classId)) throw new NotFoundError("That class isn't in your account.");
  const [found] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, classroom.teacherId)));
  if (!found) throw new NotFoundError("That class isn't in your account.");
}

export async function assertStudentInScope(db: Database, classroom: Classroom, studentId: string): Promise<void> {
  const [found] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.teacherId, classroom.teacherId), inScope(students.classId, classroom.classIds)));
  if (!found) throw new NotFoundError("That student isn't in your account.");
}

export async function assertLoanInScope(db: Database, classroom: Classroom, loanId: string): Promise<void> {
  const [found] = await db
    .select({ id: loans.id })
    .from(loans)
    .innerJoin(students, eq(students.id, loans.studentId))
    .where(and(eq(loans.id, loanId), eq(loans.teacherId, classroom.teacherId), inScope(students.classId, classroom.classIds)));
  if (!found) throw new NotFoundError("That checkout wasn't found.");
}

export type AddCoTeacherOutcome = { outcome: "added" | "invited"; name: string | null; email: string };

/**
 * Shares a class. A verified account gets access straight away; anything else, including
 * an email with no account, becomes an invite that waits for a verified sign-in. An
 * unverified account is treated like no account because its owner never proved the
 * address is theirs: someone could register a colleague's email with a password first,
 * and be handed the students.
 */
export async function addCoTeacher(
  db: Database,
  ownerId: string,
  classId: string,
  rawEmail: string,
): Promise<AddCoTeacherOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const [klass] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, ownerId)));
  if (!klass) throw new NotFoundError("That class isn't in your account.");

  const [target] = await db
    .select({ id: user.id, name: user.name, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email));
  if (target?.id === ownerId) throw new ConflictError("That's you. You already teach this class.");

  if (target?.emailVerified) {
    await db.insert(classTeachers).values({ classId, ownerTeacherId: ownerId, coTeacherId: target.id }).onConflictDoNothing();
    return { outcome: "added", name: target.name, email };
  }
  await db.insert(classTeacherInvites).values({ classId, ownerTeacherId: ownerId, email }).onConflictDoNothing();
  return { outcome: "invited", name: target?.name ?? null, email };
}

export async function listClassCoTeachers(db: Database, ownerId: string, classId: string) {
  const [coTeachers, invites] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(classTeachers)
      .innerJoin(user, eq(user.id, classTeachers.coTeacherId))
      .where(and(eq(classTeachers.classId, classId), eq(classTeachers.ownerTeacherId, ownerId)))
      .orderBy(asc(user.name)),
    db
      .select({ id: classTeacherInvites.id, email: classTeacherInvites.email })
      .from(classTeacherInvites)
      .where(and(eq(classTeacherInvites.classId, classId), eq(classTeacherInvites.ownerTeacherId, ownerId)))
      .orderBy(asc(classTeacherInvites.email)),
  ]);
  return { coTeachers, invites };
}

export async function removeCoTeacher(db: Database, ownerId: string, classId: string, coTeacherId: string): Promise<void> {
  await db
    .delete(classTeachers)
    .where(
      and(
        eq(classTeachers.classId, classId),
        eq(classTeachers.ownerTeacherId, ownerId),
        eq(classTeachers.coTeacherId, coTeacherId),
      ),
    );
}

export async function cancelCoTeacherInvite(db: Database, ownerId: string, inviteId: string): Promise<void> {
  await db
    .delete(classTeacherInvites)
    .where(and(eq(classTeacherInvites.id, inviteId), eq(classTeacherInvites.ownerTeacherId, ownerId)));
}

/** A co-teacher stepping away from one of the classes shared with them. */
export async function leaveClass(db: Database, coTeacherId: string, classId: string): Promise<void> {
  await db.delete(classTeachers).where(and(eq(classTeachers.classId, classId), eq(classTeachers.coTeacherId, coTeacherId)));
}

/**
 * Turns invites for this address into real grants, the first time its owner is signed in
 * with it verified. Returns how many classes were claimed. Cheap enough to call on every
 * page: one indexed lookup, and nothing at all for an unverified account.
 */
export async function claimCoTeacherInvites(
  db: Database,
  account: { id: string; email: string; emailVerified: boolean },
): Promise<number> {
  if (!account.emailVerified) return 0;
  const email = account.email.toLowerCase();
  const invites = await db.select().from(classTeacherInvites).where(eq(classTeacherInvites.email, email));
  if (invites.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const invite of invites) {
      if (invite.ownerTeacherId !== account.id) {
        await tx
          .insert(classTeachers)
          .values({ classId: invite.classId, ownerTeacherId: invite.ownerTeacherId, coTeacherId: account.id })
          .onConflictDoNothing();
      }
    }
    await tx.delete(classTeacherInvites).where(eq(classTeacherInvites.email, email));
  });
  return invites.length;
}
