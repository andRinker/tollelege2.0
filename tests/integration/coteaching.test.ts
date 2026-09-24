import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { classes, classTeacherInvites, classTeachers, loans, students, user } from "@/db/schema";
import { createBook, getBookDetail } from "@/server/catalog";
import { circulationStats, listOpenLoans, recentActivity } from "@/server/circulation";
import {
  addCoTeacher,
  assertClassInScope,
  assertLoanInScope,
  assertOwner,
  assertStudentInScope,
  claimCoTeacherInvites,
  type Classroom,
  leaveClass,
  listClassCoTeachers,
  listSharedClassrooms,
  removeCoTeacher,
  resolveClassroom,
} from "@/server/coteaching";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { findStudents, listClasses, rosterCounts } from "@/server/roster";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const TODAY = "2026-10-01";

/**
 * One owner, two classes. Room 12 is shared with a co-teacher; Room 14 isn't; one student
 * belongs to no class. A copy of the same book is out to a student in each class.
 */
describe("co-teaching", () => {
  let testDb: TestDatabase;
  let db: Database;
  let owner: string;
  let coTeacher: string;
  let stranger: string;
  let shared: string;
  let privateClass: string;
  let ada: string; // Room 12
  let ben: string; // Room 14
  let cy: string; // no class
  let bookId: string;
  let adaLoan: string;
  let benLoan: string;
  let room: Classroom;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    owner = await createTeacher(db, "Maria Alvarez", "alvarez@augprep.org");
    coTeacher = await createTeacher(db, "Dan Brooks", "brooks@augprep.org");
    stranger = await createTeacher(db, "Eve Stone", "stone@augprep.org");

    [{ id: shared }, { id: privateClass }] = await db
      .insert(classes)
      .values([
        { teacherId: owner, name: "Room 12", schoolYear: "2026–27" },
        { teacherId: owner, name: "Room 14", schoolYear: "2026–27" },
      ])
      .returning({ id: classes.id });
    [{ id: ada }, { id: ben }, { id: cy }] = await db
      .insert(students)
      .values([
        { teacherId: owner, classId: shared, firstName: "Ada" },
        { teacherId: owner, classId: privateClass, firstName: "Ben" },
        { teacherId: owner, classId: null, firstName: "Cy" },
      ])
      .returning({ id: students.id });

    const book = await createBook(db, owner, {
      isbn13: null, title: "Hatchet", subtitle: null, authors: [], description: null, coverUrl: null, publisher: null,
      publishedYear: null, pageCount: null, readingLevel: null, tags: [], location: null, notes: null, metadataSource: "manual",
    }, 3);
    bookId = book.bookId;
    [{ id: adaLoan }, { id: benLoan }] = await db
      .insert(loans)
      .values([
        { teacherId: owner, copyId: book.copyIds[0], bookId, bookTitle: "Hatchet", studentId: ada },
        { teacherId: owner, copyId: book.copyIds[1], bookId, bookTitle: "Hatchet", studentId: ben },
      ])
      .returning({ id: loans.id });

    expect(await addCoTeacher(db, owner, shared, " Brooks@AugPrep.org ")).toMatchObject({ outcome: "added", name: "Dan Brooks" });
    room = await resolveClassroom(db, { teacherId: coTeacher, name: "Dan Brooks" }, owner);
    return () => testDb.close();
  });

  describe("whose classroom a request is in", () => {
    it("gives a co-teacher the owner's classroom, limited to what was shared", () => {
      expect(room).toEqual({
        teacherId: owner,
        actorId: coTeacher,
        isOwner: false,
        ownerName: "Maria Alvarez",
        classIds: [shared],
      });
    });

    it("falls back to your own classroom for anything you can't reach", async () => {
      const eve = { teacherId: stranger, name: "Eve Stone" };
      for (const asked of [owner, "not-a-teacher", "", null]) {
        expect(await resolveClassroom(db, eve, asked)).toMatchObject({ teacherId: stranger, isOwner: true, classIds: null });
      }
    });

    it("lists the classrooms shared with someone, for the switcher", async () => {
      expect(await listSharedClassrooms(db, coTeacher)).toEqual([
        { ownerId: owner, ownerName: "Maria Alvarez", classes: [{ id: shared, name: "Room 12" }] },
      ]);
      expect(await listSharedClassrooms(db, stranger)).toEqual([]);
    });
  });

  describe("what a co-teacher sees", () => {
    it("only the shared classes and their students, never the unassigned ones", async () => {
      expect((await listClasses(db, owner, TODAY, room.classIds)).map((klass) => klass.name)).toEqual(["Room 12"]);
      expect((await findStudents(db, owner, { today: TODAY, classIds: room.classIds })).map((s) => s.firstName)).toEqual(["Ada"]);
      expect(await rosterCounts(db, owner, room.classIds)).toEqual({ students: 1, classes: 1 });
      // The owner, unscoped, still sees everything.
      expect((await findStudents(db, owner, { today: TODAY })).map((s) => s.firstName).sort()).toEqual(["Ada", "Ben", "Cy"]);
    });

    it("only the shared classes' checkouts", async () => {
      expect((await listOpenLoans(db, owner, { today: TODAY, classIds: room.classIds })).map((loan) => loan.studentName)).toEqual(["Ada"]);
      expect((await recentActivity(db, owner, 10, room.classIds)).every((item) => item.studentName === "Ada")).toBe(true);
      expect((await circulationStats(db, owner, TODAY, "UTC", room.classIds)).booksOut).toBe(1);
      expect((await circulationStats(db, owner, TODAY, "UTC")).booksOut).toBe(2);
    });

    it("a copy out to another class as checked out, but not who has it", async () => {
      const { copies, history } = await getBookDetail(db, owner, bookId, room.classIds);
      const [toAda, toBen, onShelf] = copies;
      expect(toAda).toMatchObject({ studentFirstName: "Ada", borrowerHidden: false, loanId: adaLoan });
      expect(toBen).toMatchObject({ studentFirstName: null, studentId: null, loanId: null, borrowerHidden: true });
      expect(onShelf).toMatchObject({ loanId: null, borrowerHidden: false });
      expect(history.map((loan) => loan.studentFirstName)).toEqual(["Ada"]);

      const asOwner = await getBookDetail(db, owner, bookId);
      expect(asOwner.copies[1]).toMatchObject({ studentFirstName: "Ben", borrowerHidden: false });
    });
  });

  describe("what a co-teacher can't reach", () => {
    it("a class, student or checkout outside what was shared looks like it doesn't exist", async () => {
      await expect(assertClassInScope(db, room, privateClass)).rejects.toBeInstanceOf(NotFoundError);
      await expect(assertStudentInScope(db, room, ben)).rejects.toBeInstanceOf(NotFoundError);
      await expect(assertStudentInScope(db, room, cy)).rejects.toBeInstanceOf(NotFoundError);
      await expect(assertLoanInScope(db, room, benLoan)).rejects.toBeInstanceOf(NotFoundError);
      // And the shared ones pass.
      await assertClassInScope(db, room, shared);
      await assertStudentInScope(db, room, ada);
      await assertLoanInScope(db, room, adaLoan);
    });

    it("the owner's decisions, with a message naming the owner", () => {
      expect(() => assertOwner(room, "delete books from this library")).toThrow(
        new ForbiddenError("Only Maria Alvarez can delete books from this library."),
      );
      expect(() => assertOwner(resolveOwn(owner), "delete books")).not.toThrow();
    });
  });

  describe("inviting", () => {
    it("invites an email with no account, and hands the class over on a verified sign-in", async () => {
      expect(await addCoTeacher(db, owner, shared, "new.teacher@augprep.org")).toMatchObject({ outcome: "invited", name: null });
      expect((await listClassCoTeachers(db, owner, shared)).invites.map((invite) => invite.email)).toEqual(["new.teacher@augprep.org"]);

      const newcomer = await createTeacher(db, "New Teacher", "new.teacher@augprep.org");
      expect(await claimCoTeacherInvites(db, { id: newcomer, email: "New.Teacher@augprep.org", emailVerified: true })).toBe(1);
      expect((await resolveClassroom(db, { teacherId: newcomer, name: "New Teacher" }, owner)).classIds).toEqual([shared]);
      expect(await db.select().from(classTeacherInvites)).toHaveLength(0);
    });

    it("never hands a class to an unverified address, which could be anyone's", async () => {
      const squatter = await createTeacher(db, "Not Really Them", "colleague@augprep.org");
      await db.update(user).set({ emailVerified: false }).where(eq(user.id, squatter));

      // An existing but unverified account is invited, not added.
      expect(await addCoTeacher(db, owner, shared, "colleague@augprep.org")).toMatchObject({ outcome: "invited" });
      expect(await claimCoTeacherInvites(db, { id: squatter, email: "colleague@augprep.org", emailVerified: false })).toBe(0);
      expect((await resolveClassroom(db, { teacherId: squatter, name: "x" }, owner)).isOwner).toBe(true);
    });

    it("refuses adding yourself, or to a class that isn't yours", async () => {
      await expect(addCoTeacher(db, owner, shared, "alvarez@augprep.org")).rejects.toBeInstanceOf(ConflictError);
      await expect(addCoTeacher(db, stranger, shared, "brooks@augprep.org")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("ending it", () => {
    it("a co-teacher can leave, and an owner can remove them, straight away", async () => {
      const other = await createTeacher(db, "Fay Moss", "moss@augprep.org");
      await addCoTeacher(db, owner, shared, "moss@augprep.org");
      await leaveClass(db, other, shared);
      expect((await resolveClassroom(db, { teacherId: other, name: "Fay Moss" }, owner)).isOwner).toBe(true);

      await addCoTeacher(db, owner, shared, "moss@augprep.org");
      await removeCoTeacher(db, owner, shared, other);
      expect((await resolveClassroom(db, { teacherId: other, name: "Fay Moss" }, owner)).isOwner).toBe(true);
    });

    it("deleting a class ends the sharing with it", async () => {
      const [temp] = await db.insert(classes).values({ teacherId: owner, name: "Temp", schoolYear: "2026–27" }).returning();
      await addCoTeacher(db, owner, temp.id, "brooks@augprep.org");
      await db.delete(classes).where(eq(classes.id, temp.id));
      expect(await db.select().from(classTeachers).where(eq(classTeachers.classId, temp.id))).toHaveLength(0);
    });
  });

  it("the database refuses a grant naming someone else as the owner of a class", async () => {
    await expect(
      db.insert(classTeachers).values({ classId: shared, ownerTeacherId: stranger, coTeacherId: coTeacher }),
    ).rejects.toThrow();
  });
});

function resolveOwn(teacherId: string): Classroom {
  return { teacherId, actorId: teacherId, isOwner: true, ownerName: "Maria Alvarez", classIds: null };
}
