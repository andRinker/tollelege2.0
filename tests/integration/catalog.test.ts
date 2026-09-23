import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { classes, copies, loans, students } from "@/db/schema";
import {
  addCopies,
  type BookDetailsInput,
  catalogSummary,
  createBook,
  deleteBook,
  deleteCopy,
  findBookByIsbn,
  getBookDetail,
  listBookIdentities,
  listBooks,
  normalizeTags,
  quickAddByIsbn,
  setCopyStatus,
  undoQuickAdd,
  updateBookDetails,
} from "@/server/catalog";
import { checkInLoan, checkOutBook, recentActivity, undoCheckIn } from "@/server/circulation";
import { ConflictError, NotFoundError } from "@/server/errors";
import { getStudentDetail } from "@/server/roster";
import type { BookMetadata } from "@/server/isbn-lookup";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

function bookInput(overrides: Partial<BookDetailsInput> = {}): BookDetailsInput {
  return {
    isbn13: null,
    title: "Untitled",
    subtitle: null,
    authors: [],
    description: null,
    coverUrl: null,
    publisher: null,
    publishedYear: null,
    pageCount: null,
    readingLevel: null,
    tags: [],
    location: null,
    notes: null,
    metadataSource: "manual",
    ...overrides,
  };
}

const frogAndToad: BookMetadata = {
  isbn13: "9780064440202",
  title: "Frog and Toad Are Friends",
  subtitle: null,
  authors: ["Arnold Lobel"],
  description: null,
  coverUrl: "https://covers.openlibrary.org/b/id/51292-M.jpg",
  publisher: "HarperTrophy",
  publishedYear: 1979,
  pageCount: 64,
  source: "openlibrary",
};

async function checkOut(db: Database, teacherId: string, copyId: string) {
  const [klass] = await db.insert(classes).values({ teacherId, name: "Room 1", schoolYear: "2026–27" }).returning();
  const [student] = await db.insert(students).values({ teacherId, classId: klass.id, firstName: "Ada" }).returning();
  const [loan] = await db.insert(loans).values({ bookTitle: "A book", teacherId, copyId, studentId: student.id }).returning();
  return loan;
}

describe("catalog", () => {
  let testDb: TestDatabase;
  let db: Database;
  let teacher: string;
  let otherTeacher: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    teacher = await createTeacher(db, "Ms. Frizzle");
    otherTeacher = await createTeacher(db, "Mr. Ratburn");
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("normalizes tags", () => {
    expect(normalizeTags([" Animals ", "animals", "Series  Books", "", "Friendship"])).toEqual(["Animals", "Series Books", "Friendship"]);
  });

  it("creates a book with numbered copies and rejects a duplicate ISBN", async () => {
    const { bookId, copyIds } = await createBook(db, teacher, bookInput({ title: "Wonder", isbn13: "9780375869020" }), 3);
    expect(copyIds).toHaveLength(3);
    const detail = await getBookDetail(db, teacher, bookId);
    expect(detail.copies.map((copy) => copy.copyNumber)).toEqual([1, 2, 3]);

    await expect(createBook(db, teacher, bookInput({ title: "Wonder again", isbn13: "9780375869020" }))).rejects.toBeInstanceOf(ConflictError);
    // Another teacher can own the same ISBN.
    await expect(createBook(db, otherTeacher, bookInput({ title: "Wonder", isbn13: "9780375869020" }))).resolves.toBeDefined();
  });

  it("lists book identities with a live copy count", async () => {
    const { bookId } = await createBook(db, teacher, bookInput({ title: "Frindle", isbn13: "9780689818769" }), 3);
    const identities = await listBookIdentities(db, teacher);
    const frindle = identities.find((identity) => identity.id === bookId);
    expect(frindle?.copies).toBe(3);
    expect(frindle).toMatchObject({ title: "Frindle", isbn13: "9780689818769" });
    // Only this teacher's shelves, so a scan can never recognise someone else's book.
    expect(await listBookIdentities(db, otherTeacher)).not.toContainEqual(expect.objectContaining({ id: bookId }));
  });

  it("reports how many copies an owned book has", async () => {
    // This count reaches the teacher as "You have N copies" when they look up an ISBN
    // they already own, and read 0 for every book until the query was fixed.
    const { bookId } = await createBook(db, teacher, bookInput({ title: "Bud, Not Buddy", isbn13: "9780553494105" }), 2);
    const found = await findBookByIsbn(db, teacher, "9780553494105");
    expect(found).toMatchObject({ id: bookId, totalCopies: 2 });
    expect(await findBookByIsbn(db, otherTeacher, "9780553494105")).toBeNull();
  });

  it("adds copies after the highest copy number", async () => {
    const { bookId, copyIds } = await createBook(db, teacher, bookInput({ title: "Holes" }), 2);
    await db.delete(copies).where(eq(copies.id, copyIds[0]));
    const { totalCopies } = await addCopies(db, teacher, bookId, 2);
    expect(totalCopies).toBe(3);
    const detail = await getBookDetail(db, teacher, bookId);
    expect(detail.copies.map((copy) => copy.copyNumber)).toEqual([2, 3, 4]);
  });

  it("quick-adds a new title, then adds copies of it, and undoes both", async () => {
    const first = await quickAddByIsbn(db, teacher, frogAndToad.isbn13, frogAndToad);
    expect(first).toMatchObject({ outcome: "created", title: "Frog and Toad Are Friends", totalCopies: 1 });

    const second = await quickAddByIsbn(db, teacher, frogAndToad.isbn13, frogAndToad);
    expect(second).toMatchObject({ outcome: "copy_added", bookId: first.bookId, totalCopies: 2 });

    expect(await undoQuickAdd(db, teacher, second.copyId)).toBe("copy_removed");
    expect(await undoQuickAdd(db, teacher, first.copyId)).toBe("book_removed");
    await expect(getBookDetail(db, teacher, first.bookId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("won't undo a quick add after the copy was checked out", async () => {
    const added = await quickAddByIsbn(db, teacher, "9780439708180", { ...frogAndToad, isbn13: "9780439708180", title: "Harry Potter" });
    await checkOut(db, teacher, added.copyId);
    await expect(undoQuickAdd(db, teacher, added.copyId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists books with availability, search, filters, and article-aware sorting", async () => {
    const t = await createTeacher(db, "List Teacher");
    const giver = await createBook(db, t, bookInput({ title: "The Giver", authors: ["Lois Lowry"], tags: ["Dystopia"], readingLevel: "Y" }), 2);
    await createBook(db, t, bookInput({ title: "A Wrinkle in Time", authors: ["Madeleine L'Engle"], tags: ["Fantasy"], location: "Bin 3" }));
    await createBook(db, t, bookInput({ title: "Charlotte's Web", authors: ["E. B. White"], tags: ["Animals", "Friendship"], isbn13: "9780064400558" }));
    await checkOut(db, t, giver.copyIds[0]);

    const all = await listBooks(db, t);
    expect(all.items.map((book) => book.title)).toEqual(["Charlotte's Web", "The Giver", "A Wrinkle in Time"]);
    expect(all.items.find((book) => book.title === "The Giver")).toMatchObject({ totalCopies: 2, availableCopies: 1 });

    expect((await listBooks(db, t, { query: "lowry" })).items.map((b) => b.title)).toEqual(["The Giver"]);
    expect((await listBooks(db, t, { query: "978-0-06-440055-8" })).items.map((b) => b.title)).toEqual(["Charlotte's Web"]);
    expect((await listBooks(db, t, { query: "100%" })).total).toBe(0);
    expect((await listBooks(db, t, { tag: "Friendship" })).items.map((b) => b.title)).toEqual(["Charlotte's Web"]);
    expect((await listBooks(db, t, { location: "Bin 3" })).total).toBe(1);
    expect((await listBooks(db, t, { readingLevel: "Y" })).total).toBe(1);
    expect((await listBooks(db, t, { availability: "out" })).items.map((b) => b.title)).toEqual(["The Giver"]);
    expect((await listBooks(db, t, { availability: "available" })).total).toBe(3);
    expect((await listBooks(db, t, { sort: "author" })).items[0].title).toBe("A Wrinkle in Time");

    const summary = await catalogSummary(db, t);
    expect(summary).toMatchObject({ titles: 3, copies: 4, tags: ["Animals", "Dystopia", "Fantasy", "Friendship"], readingLevels: ["Y"], locations: ["Bin 3"] });

    const page = await listBooks(db, t, { pageSize: 2, page: 2 });
    expect(page).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(page.items).toHaveLength(1);
  });

  it("won't delete a book or copy while it is checked out", async () => {
    const { bookId, copyIds } = await createBook(db, teacher, bookInput({ title: "Hatchet" }), 2);
    await checkOut(db, teacher, copyIds[0]);

    await expect(deleteBook(db, teacher, bookId)).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteCopy(db, teacher, copyIds[0])).rejects.toBeInstanceOf(ConflictError);
    await expect(setCopyStatus(db, teacher, copyIds[0], "withdrawn")).rejects.toBeInstanceOf(ConflictError);

    await setCopyStatus(db, teacher, copyIds[1], "damaged");
    const detail = await getBookDetail(db, teacher, bookId);
    expect(detail.copies.find((copy) => copy.id === copyIds[1])?.status).toBe("damaged");
    expect(detail.copies.find((copy) => copy.id === copyIds[0])?.studentFirstName).toBe("Ada");

    const lonely = await createBook(db, teacher, bookInput({ title: "Single copy" }));
    await expect(deleteCopy(db, teacher, lonely.copyIds[0])).rejects.toBeInstanceOf(ConflictError);
    await deleteBook(db, teacher, lonely.bookId);
  });

  it("deletes a book students have read, and keeps it in their reading history", async () => {
    const t = await createTeacher(db, "History Teacher");
    const [klass] = await db.insert(classes).values({ teacherId: t, name: "Room 4", schoolYear: "2026–27" }).returning();
    const [ada] = await db.insert(students).values({ teacherId: t, classId: klass.id, firstName: "Ada" }).returning();
    const { bookId, copyIds } = await createBook(db, t, bookInput({ title: "Hatchet", authors: ["Gary Paulsen"] }), 2);

    // Both out at once, so they take copy 1 and copy 2.
    const first = await checkOutBook(db, t, { studentId: ada.id, bookId, dueOn: null });
    const second = await checkOutBook(db, t, { studentId: ada.id, bookId, dueOn: null });
    expect([first.copyNumber, second.copyNumber]).toEqual([1, 2]);
    await expect(deleteBook(db, t, bookId)).rejects.toThrow("checked out");
    await checkInLoan(db, t, first.loanId);
    await checkInLoan(db, t, second.loanId);

    // The copy goes first. Its checkout stays on the book's page, just without a copy number.
    await deleteCopy(db, t, copyIds[0]);
    const detail = await getBookDetail(db, t, bookId);
    expect(detail.copies.map((copy) => copy.id)).toEqual([copyIds[1]]);
    expect(detail.history.map((loan) => loan.copyNumber).sort()).toEqual([2, null]);

    // A title fixed after the fact is what the history shows while the book is still here.
    await updateBookDetails(db, t, bookId, { title: "Hatchet (Anniversary Edition)" });
    expect((await getStudentDetail(db, t, ada.id)).history[0].title).toBe("Hatchet (Anniversary Edition)");

    await deleteBook(db, t, bookId);
    await expect(getBookDetail(db, t, bookId)).rejects.toBeInstanceOf(NotFoundError);

    // Once it's gone, the title it went out under.
    const { history } = await getStudentDetail(db, t, ada.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ title: "Hatchet", authors: ["Gary Paulsen"], bookId: null, coverUrl: null });
    const activity = await recentActivity(db, t);
    expect(activity.filter((item) => item.title === "Hatchet")).toHaveLength(4);
    expect(activity.every((item) => item.bookId === null)).toBe(true);

    // Undoing a return needs a copy to put back in the student's hands.
    await expect(undoCheckIn(db, t, first.loanId)).rejects.toThrow("That copy has been deleted");
  });

  it("keeps every catalog operation inside the teacher's own library", async () => {
    const { bookId, copyIds } = await createBook(db, teacher, bookInput({ title: "Private book", isbn13: "9780316015844" }), 2);

    await expect(getBookDetail(db, otherTeacher, bookId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addCopies(db, otherTeacher, bookId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateBookDetails(db, otherTeacher, bookId, { title: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteBook(db, otherTeacher, bookId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCopyStatus(db, otherTeacher, copyIds[0], "lost")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCopy(db, otherTeacher, copyIds[0])).rejects.toBeInstanceOf(NotFoundError);
    await expect(undoQuickAdd(db, otherTeacher, copyIds[0])).rejects.toBeInstanceOf(NotFoundError);

    const theirs = await listBooks(db, otherTeacher, { query: "Private" });
    expect(theirs.total).toBe(0);
    expect((await getBookDetail(db, teacher, bookId)).book.title).toBe("Private book");
  });
});
