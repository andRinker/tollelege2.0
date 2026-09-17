import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { books, classes, copies, loans, students, user } from "@/db/schema";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

// Database-level guarantees that back the app's tenant isolation and checkout rules.
describe("database integrity", () => {
  let testDb: TestDatabase;
  let teacherA: string;
  let teacherB: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    teacherA = await createTeacher(testDb.db, "Teacher A");
    teacherB = await createTeacher(testDb.db, "Teacher B");
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function seedLibrary(teacherId: string, isbn13: string) {
    const { db } = testDb;
    const [klass] = await db
      .insert(classes)
      .values({ teacherId, name: "Room 12", schoolYear: "2026–27" })
      .returning();
    const [student] = await db
      .insert(students)
      .values({ teacherId, classId: klass.id, firstName: "Ada", lastName: "L." })
      .returning();
    const [book] = await db
      .insert(books)
      .values({ teacherId, title: "Frog and Toad", authors: ["Arnold Lobel"], isbn13 })
      .returning();
    const [copy] = await db
      .insert(copies)
      .values({ teacherId, bookId: book.id, copyNumber: 1 })
      .returning();
    return { klass, student, book, copy };
  }

  it("rejects a loan that links one teacher's copy to another teacher's student", async () => {
    const a = await seedLibrary(teacherA, "9780064440202");
    const b = await seedLibrary(teacherB, "9780064440202");

    await expect(
      testDb.db.insert(loans).values({ teacherId: teacherA, copyId: a.copy.id, studentId: b.student.id }),
    ).rejects.toThrow();
    await expect(
      testDb.db.insert(loans).values({ teacherId: teacherB, copyId: a.copy.id, studentId: b.student.id }),
    ).rejects.toThrow();
  });

  it("rejects a student placed in another teacher's class", async () => {
    const [otherClass] = await testDb.db
      .insert(classes)
      .values({ teacherId: teacherB, name: "Period 3", schoolYear: "2026–27" })
      .returning();

    await expect(
      testDb.db.insert(students).values({ teacherId: teacherA, classId: otherClass.id, firstName: "Grace" }),
    ).rejects.toThrow();
  });

  it("allows only one open loan per copy", async () => {
    const lib = await seedLibrary(teacherA, "9780439708180");
    const { db } = testDb;
    await db.insert(loans).values({ teacherId: teacherA, copyId: lib.copy.id, studentId: lib.student.id });

    await expect(
      db.insert(loans).values({ teacherId: teacherA, copyId: lib.copy.id, studentId: lib.student.id }),
    ).rejects.toThrow();

    await db
      .update(loans)
      .set({ closedAt: new Date(), closeReason: "returned" })
      .where(eq(loans.copyId, lib.copy.id));
    await expect(
      db.insert(loans).values({ teacherId: teacherA, copyId: lib.copy.id, studentId: lib.student.id }),
    ).resolves.toBeDefined();
  });

  it("keeps ISBNs unique within a teacher's library only", async () => {
    const { db } = testDb;
    const isbn13 = "9780545010221";
    await db.insert(books).values({ teacherId: teacherA, title: "Deathly Hallows", isbn13 });
    await db.insert(books).values({ teacherId: teacherB, title: "Deathly Hallows", isbn13 });

    await expect(
      db.insert(books).values({ teacherId: teacherA, title: "Duplicate", isbn13 }),
    ).rejects.toThrow();
  });

  it("rejects malformed ISBNs and inconsistent loan closing", async () => {
    const { db } = testDb;
    await expect(
      db.insert(books).values({ teacherId: teacherA, title: "Bad ISBN", isbn13: "12345" }),
    ).rejects.toThrow();

    const lib = await seedLibrary(teacherA, "9780316015844");
    await expect(
      db.insert(loans).values({
        teacherId: teacherA,
        copyId: lib.copy.id,
        studentId: lib.student.id,
        closedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("deletes all of a teacher's data when the account is deleted", async () => {
    const { db } = testDb;
    const teacherC = await createTeacher(db, "Teacher C");
    const lib = await seedLibrary(teacherC, "9780062315007");
    await db.insert(loans).values({ teacherId: teacherC, copyId: lib.copy.id, studentId: lib.student.id });

    await db.delete(user).where(eq(user.id, teacherC));

    expect(await db.select().from(books).where(eq(books.teacherId, teacherC))).toHaveLength(0);
    expect(await db.select().from(copies).where(eq(copies.teacherId, teacherC))).toHaveLength(0);
    expect(await db.select().from(students).where(eq(students.teacherId, teacherC))).toHaveLength(0);
    expect(await db.select().from(loans).where(eq(loans.teacherId, teacherC))).toHaveLength(0);
  });
});
