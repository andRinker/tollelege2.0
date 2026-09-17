import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { loans } from "@/db/schema";
import { type BookDetailsInput, createBook, getBookDetail, setCopyStatus } from "@/server/catalog";
import {
  checkInLoan,
  checkOutBook,
  circulationStats,
  findBooksToCheckOut,
  listOpenLoans,
  markLoanLost,
  recentActivity,
  UNDO_WINDOW_MS,
  undoCheckIn,
  undoCheckOut,
} from "@/server/circulation";
import { ConflictError, LimitError, NotFoundError } from "@/server/errors";
import { addStudent, createClass, setStudentActive } from "@/server/roster";
import { updateTeacherSettings } from "@/server/settings";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const TODAY = "2026-09-17";

function book(title: string): BookDetailsInput {
  return {
    isbn13: null, title, subtitle: null, authors: ["Roald Dahl"], description: null, coverUrl: null, publisher: null,
    publishedYear: null, pageCount: null, readingLevel: null, tags: [], location: null, notes: null, metadataSource: "manual",
  };
}

describe("circulation", () => {
  let testDb: TestDatabase;
  let db: Database;
  let teacher: string;
  let otherTeacher: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    teacher = await createTeacher(db, "Miss Honey");
    otherTeacher = await createTeacher(db, "Mr. Wormwood");
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function student(teacherId: string, firstName: string) {
    const klass = await createClass(db, teacherId, { name: `Class ${firstName}`, schoolYear: "2026–27" });
    return (await addStudent(db, teacherId, klass.id, { firstName, lastName: "Test", studentNumber: null }))!;
  }

  it("checks out the lowest available copy, skipping lost and checked-out copies", async () => {
    const { bookId, copyIds } = await createBook(db, teacher, book("Matilda"), 3);
    const ada = await student(teacher, "Ada");
    const bo = await student(teacher, "Bo");
    await setCopyStatus(db, teacher, copyIds[0], "lost");

    const first = await checkOutBook(db, teacher, { studentId: ada.id, bookId, dueOn: "2026-10-01" });
    expect(first).toMatchObject({ copyNumber: 2, title: "Matilda", studentName: "Ada Test", dueOn: "2026-10-01" });
    const second = await checkOutBook(db, teacher, { studentId: bo.id, bookId, dueOn: null });
    expect(second.copyNumber).toBe(3);

    await expect(checkOutBook(db, teacher, { studentId: bo.id, bookId, dueOn: null })).rejects.toThrow(
      new ConflictError("Every copy of Matilda is checked out."),
    );
  });

  it("never lends the same copy twice, even when requests arrive together", async () => {
    const { bookId } = await createBook(db, teacher, book("The BFG"), 1);
    const kids = await Promise.all(["Cam", "Dee", "Eli"].map((name) => student(teacher, name)));
    const results = await Promise.allSettled(kids.map((kid) => checkOutBook(db, teacher, { studentId: kid.id, bookId, dueOn: null })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
  });

  it("enforces the per-student limit and skips inactive students", async () => {
    const limitTeacher = await createTeacher(db, "Limit Teacher");
    await updateTeacherSettings(db, limitTeacher, { maxBooksPerStudent: 2 });
    const kid = await student(limitTeacher, "Fay");
    const books = await Promise.all(["A", "B", "C"].map((title) => createBook(db, limitTeacher, book(title))));
    await checkOutBook(db, limitTeacher, { studentId: kid.id, bookId: books[0].bookId, dueOn: null });
    await checkOutBook(db, limitTeacher, { studentId: kid.id, bookId: books[1].bookId, dueOn: null });
    await expect(checkOutBook(db, limitTeacher, { studentId: kid.id, bookId: books[2].bookId, dueOn: null })).rejects.toBeInstanceOf(LimitError);

    const gone = await student(limitTeacher, "Gus");
    await setStudentActive(db, limitTeacher, gone.id, false);
    await expect(checkOutBook(db, limitTeacher, { studentId: gone.id, bookId: books[2].bookId, dueOn: null })).rejects.toBeInstanceOf(ConflictError);
  });

  it("checks in, undoes returns and checkouts within the window, and not after", async () => {
    const { bookId } = await createBook(db, teacher, book("Fantastic Mr Fox"), 1);
    const kid = await student(teacher, "Hal");
    const loan = await checkOutBook(db, teacher, { studentId: kid.id, bookId, dueOn: null });

    const returned = await checkInLoan(db, teacher, loan.loanId);
    expect(returned).toMatchObject({ title: "Fantastic Mr Fox", studentName: "Hal Test", copyNumber: 1 });
    await expect(checkInLoan(db, teacher, loan.loanId)).rejects.toBeInstanceOf(ConflictError);

    await undoCheckIn(db, teacher, loan.loanId);
    expect(await listOpenLoans(db, teacher, { today: TODAY, bookId })).toHaveLength(1);

    const later = new Date(Date.now() + UNDO_WINDOW_MS + 1000);
    await expect(undoCheckOut(db, teacher, loan.loanId, later)).rejects.toBeInstanceOf(ConflictError);
    await undoCheckOut(db, teacher, loan.loanId);
    expect(await listOpenLoans(db, teacher, { today: TODAY, bookId })).toHaveLength(0);

    // A return can't be undone once the copy has gone out again.
    const again = await checkOutBook(db, teacher, { studentId: kid.id, bookId, dueOn: null });
    await checkInLoan(db, teacher, again.loanId);
    const other = await student(teacher, "Ivy");
    await checkOutBook(db, teacher, { studentId: other.id, bookId, dueOn: null });
    await expect(undoCheckIn(db, teacher, again.loanId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("marks a checked-out book lost and takes the copy out of circulation", async () => {
    const { bookId } = await createBook(db, teacher, book("George's Marvellous Medicine"), 2);
    const kid = await student(teacher, "Jo");
    const loan = await checkOutBook(db, teacher, { studentId: kid.id, bookId, dueOn: null });
    await markLoanLost(db, teacher, loan.loanId);

    const detail = await getBookDetail(db, teacher, bookId);
    expect(detail.copies.find((copy) => copy.copyNumber === loan.copyNumber)?.status).toBe("lost");
    expect(detail.history[0]).toMatchObject({ closeReason: "lost" });
    const [available] = await findBooksToCheckOut(db, teacher, "Marvellous");
    expect(available).toMatchObject({ total: 1, available: 1 });
  });

  it("lists open loans with overdue ones first and reports today's numbers", async () => {
    const t = await createTeacher(db, "Stats Teacher");
    const kid = await student(t, "Kit");
    const titles = ["Due later", "Overdue", "No due date", "Due today"];
    const created = await Promise.all(titles.map((title) => createBook(db, t, book(title))));
    const dueDates = ["2026-09-30", "2026-09-10", null, TODAY];
    for (const [index, { bookId }] of created.entries()) {
      await checkOutBook(db, t, { studentId: kid.id, bookId, dueOn: dueDates[index] });
    }

    const open = await listOpenLoans(db, t, { today: TODAY });
    expect(open.map((loan) => loan.title)).toEqual(["Overdue", "Due today", "Due later", "No due date"]);
    expect(open.map((loan) => loan.overdue)).toEqual([true, false, false, false]);
    expect((await listOpenLoans(db, t, { today: TODAY, overdueOnly: true })).map((loan) => loan.title)).toEqual(["Overdue"]);

    await checkInLoan(db, t, open[2].loanId);
    const stats = await circulationStats(db, t, todayFor("UTC"), "UTC");
    expect(stats).toMatchObject({ booksOut: 3, checkedOutToday: 4, returnedToday: 1 });
    expect((await circulationStats(db, t, TODAY, "UTC")).overdue).toBe(1);

    const activity = await recentActivity(db, t, 3);
    expect(activity[0]).toMatchObject({ kind: "returned", title: "Due later" });
    expect(activity).toHaveLength(3);
  });

  it("keeps circulation inside the teacher's own account", async () => {
    const { bookId } = await createBook(db, teacher, book("The Twits"), 1);
    const mine = await student(teacher, "Lu");
    const theirs = await student(otherTeacher, "Max");
    const loan = await checkOutBook(db, teacher, { studentId: mine.id, bookId, dueOn: null });

    await expect(checkOutBook(db, otherTeacher, { studentId: theirs.id, bookId, dueOn: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(checkOutBook(db, teacher, { studentId: theirs.id, bookId, dueOn: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(checkInLoan(db, otherTeacher, loan.loanId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(undoCheckOut(db, otherTeacher, loan.loanId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(markLoanLost(db, otherTeacher, loan.loanId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(undoCheckIn(db, otherTeacher, loan.loanId)).rejects.toBeInstanceOf(NotFoundError);

    expect(await listOpenLoans(db, otherTeacher, { today: TODAY })).toEqual([]);
    expect(await findBooksToCheckOut(db, otherTeacher, "Twits")).toEqual([]);
    expect((await circulationStats(db, otherTeacher, TODAY, "UTC")).booksOut).toBe(0);
    const [stillOpen] = await db.select().from(loans).where(eq(loans.id, loan.loanId));
    expect(stillOpen.closedAt).toBeNull();
  });
});

function todayFor(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
