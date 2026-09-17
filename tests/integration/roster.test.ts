import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { loans } from "@/db/schema";
import { createBook } from "@/server/catalog";
import { ConflictError, NotFoundError } from "@/server/errors";
import {
  addStudent,
  createClass,
  deleteClass,
  deleteStudent,
  findStudents,
  getClassRoster,
  getStudentDetail,
  importStudents,
  listClasses,
  moveStudents,
  setClassArchived,
  setStudentActive,
  updateClass,
  updateStudent,
} from "@/server/roster";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const TODAY = "2026-09-17";

describe("rosters", () => {
  let testDb: TestDatabase;
  let db: Database;
  let teacher: string;
  let otherTeacher: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    teacher = await createTeacher(db, "Ms. Honey");
    otherTeacher = await createTeacher(db, "Miss Trunchbull");
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function lend(studentId: string, dueOn: string | null, closed = false) {
    const { copyIds } = await createBook(db, teacher, {
      isbn13: null, title: `Book ${Math.random()}`, subtitle: null, authors: [], description: null, coverUrl: null,
      publisher: null, publishedYear: null, pageCount: null, readingLevel: null, tags: [], location: null, notes: null, metadataSource: "manual",
    });
    await db.insert(loans).values({
      teacherId: teacher,
      copyId: copyIds[0],
      studentId,
      dueOn,
      closedAt: closed ? new Date() : null,
      closeReason: closed ? "returned" : null,
    });
  }

  it("imports students, skipping people already on the roster and taken IDs", async () => {
    const room = await createClass(db, teacher, { name: "Room 12", schoolYear: "2026–27" });
    await addStudent(db, teacher, room.id, { firstName: "Matilda", lastName: "Wormwood", studentNumber: "501" });

    const result = await importStudents(db, teacher, room.id, [
      { firstName: "matilda", lastName: "wormwood", studentNumber: null },
      { firstName: "Lavender", lastName: "Brown", studentNumber: "501" },
      { firstName: "Bruce", lastName: "Bogtrotter", studentNumber: "502" },
    ]);
    expect(result).toEqual({ added: 2, skipped: 1 });

    const roster = await getClassRoster(db, teacher, room.id, TODAY);
    expect(roster.students.map((s) => `${s.firstName} ${s.lastName} ${s.studentNumber ?? "-"}`)).toEqual([
      "Bruce Bogtrotter 502",
      "Lavender Brown -",
      "Matilda Wormwood 501",
    ]);
  });

  it("counts active students, books out, and overdue books per class", async () => {
    const room = await createClass(db, teacher, { name: "Counting Class", schoolYear: "2026–27" });
    const ada = await addStudent(db, teacher, room.id, { firstName: "Ada", lastName: "Lovelace", studentNumber: null });
    const grace = await addStudent(db, teacher, room.id, { firstName: "Grace", lastName: "Hopper", studentNumber: null });
    await addStudent(db, teacher, room.id, { firstName: "Former", lastName: "Student", studentNumber: null }).then((s) =>
      setStudentActive(db, teacher, s!.id, false),
    );
    await lend(ada!.id, "2026-09-10");
    await lend(ada!.id, "2026-09-30");
    await lend(grace!.id, null);
    await lend(grace!.id, "2026-09-01", true);

    const summary = (await listClasses(db, teacher, TODAY)).find((c) => c.id === room.id);
    expect(summary).toMatchObject({ studentCount: 2, booksOut: 3, overdue: 1 });

    const roster = await getClassRoster(db, teacher, room.id, TODAY);
    expect(roster.students.find((s) => s.firstName === "Ada")).toMatchObject({ booksOut: 2, overdue: 1 });
    expect(roster.students.find((s) => s.firstName === "Former")).toMatchObject({ active: false });

    const detail = await getStudentDetail(db, teacher, ada!.id);
    expect(detail.current).toHaveLength(2);
    expect(detail.student.className).toBe("Counting Class");

    const found = await findStudents(db, teacher, { today: TODAY, query: "grace hop" });
    expect(found.map((s) => s.firstName)).toEqual(["Grace"]);
    expect(found[0]).toMatchObject({ booksOut: 1, className: "Counting Class" });
    expect((await findStudents(db, teacher, { today: TODAY, classId: room.id })).map((s) => s.firstName)).toEqual(["Grace", "Ada"]);
  });

  it("rejects duplicate student IDs and blocks deletes that would lose data", async () => {
    const room = await createClass(db, teacher, { name: "Rules", schoolYear: "2026–27" });
    const kid = await addStudent(db, teacher, room.id, { firstName: "Miranda", lastName: "Piker", studentNumber: "900" });
    await expect(addStudent(db, teacher, room.id, { firstName: "Copy", lastName: "Cat", studentNumber: "900" })).rejects.toBeInstanceOf(ConflictError);
    // IDs only need to be unique within one teacher's account.
    await expect(addStudent(db, otherTeacher, null, { firstName: "Else", lastName: "Where", studentNumber: "900" })).resolves.toBeDefined();

    await expect(deleteClass(db, teacher, room.id)).rejects.toBeInstanceOf(ConflictError);
    await lend(kid!.id, TODAY);
    await expect(deleteStudent(db, teacher, kid!.id)).rejects.toBeInstanceOf(ConflictError);

    await setClassArchived(db, teacher, room.id, true);
    expect((await listClasses(db, teacher, TODAY)).find((c) => c.id === room.id)?.archivedAt).toBeInstanceOf(Date);

    const empty = await createClass(db, teacher, { name: "Empty", schoolYear: "2026–27" });
    await updateClass(db, teacher, empty.id, { name: "Still empty" });
    await deleteClass(db, teacher, empty.id);
  });

  it("deletes a student along with their returned-book history", async () => {
    const kid = await addStudent(db, teacher, null, { firstName: "Augustus", lastName: "Gloop", studentNumber: null });
    await lend(kid!.id, null, true);
    await deleteStudent(db, teacher, kid!.id);
    await expect(getStudentDetail(db, teacher, kid!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps every roster operation inside the teacher's own account", async () => {
    const room = await createClass(db, teacher, { name: "Private class", schoolYear: "2026–27" });
    const kid = await addStudent(db, teacher, room.id, { firstName: "Violet", lastName: "Beauregarde", studentNumber: null });
    const theirClass = await createClass(db, otherTeacher, { name: "Their class", schoolYear: "2026–27" });

    await expect(getClassRoster(db, otherTeacher, room.id, TODAY)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateClass(db, otherTeacher, room.id, { name: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setClassArchived(db, otherTeacher, room.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteClass(db, otherTeacher, room.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(importStudents(db, otherTeacher, room.id, [{ firstName: "In", lastName: "Truder", studentNumber: null }])).rejects.toBeInstanceOf(NotFoundError);
    await expect(addStudent(db, otherTeacher, room.id, { firstName: "In", lastName: "Truder", studentNumber: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getStudentDetail(db, otherTeacher, kid!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateStudent(db, otherTeacher, kid!.id, { firstName: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteStudent(db, otherTeacher, kid!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setStudentActive(db, otherTeacher, kid!.id, false)).rejects.toBeInstanceOf(NotFoundError);
    // A teacher can't move their own student into someone else's class.
    await expect(updateStudent(db, teacher, kid!.id, { classId: theirClass.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(moveStudents(db, teacher, [kid!.id], theirClass.id)).rejects.toBeInstanceOf(NotFoundError);
    // Moving someone else's student does nothing.
    await moveStudents(db, otherTeacher, [kid!.id], theirClass.id);
    expect((await getStudentDetail(db, teacher, kid!.id)).student.classId).toBe(room.id);

    expect(await findStudents(db, otherTeacher, { today: TODAY, query: "Violet" })).toEqual([]);
    expect((await listClasses(db, otherTeacher, TODAY)).map((c) => c.name)).toEqual(["Their class"]);
  });
});
