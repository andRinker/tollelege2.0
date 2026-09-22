import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books, classes, copies, shelfLoans, students, user } from "@/db/schema";
import { deleteBook, deleteCopy, setBookLendable, setCopyStatus } from "@/server/catalog";
import { checkInLoan, checkOutBook, findBooksToCheckOut } from "@/server/circulation";
import {
  areConnected,
  listConnections,
  removeConnection,
  requestConnection,
  respondToConnection,
} from "@/server/connections";
import { ConflictError, NotFoundError } from "@/server/errors";
import {
  approveShelfLoan,
  browseShelf,
  cancelShelfLoanRequest,
  declineShelfLoan,
  listShelfLoans,
  requestShelfLoan,
  returnShelfLoan,
} from "@/server/lending";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const TODAY = "2026-09-22";

describe("lending library", () => {
  let testDb: TestDatabase;
  let db: Database;
  let ana: string;
  let ben: string;

  // A fresh database per test: shelf loans span two libraries, so leftover rows from one
  // case would otherwise change what the next one sees.
  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    ana = await createTeacher(db, "Ana Ruiz", "ana@school.test");
    ben = await createTeacher(db, "Ben Osei", "ben@school.test");
    return () => testDb.close();
  });

  async function connect() {
    await requestConnection(db, ana, "ben@school.test");
    const { incoming } = await listConnections(db, ben);
    await respondToConnection(db, ben, incoming[0].connectionId, true);
  }

  async function addBook(
    teacherId: string,
    title: string,
    options: { isbn13?: string | null; copyCount?: number; lendable?: boolean } = {},
  ) {
    const [book] = await db
      .insert(books)
      .values({
        teacherId,
        title,
        authors: ["A. Writer"],
        isbn13: options.isbn13 ?? null,
        lendable: options.lendable ?? true,
      })
      .returning();
    const rows = await db
      .insert(copies)
      .values(
        Array.from({ length: options.copyCount ?? 1 }, (_, i) => ({
          teacherId,
          bookId: book.id,
          copyNumber: i + 1,
        })),
      )
      .returning();
    return { book, copies: rows };
  }

  async function addStudent(teacherId: string, firstName: string) {
    const [klass] = await db
      .insert(classes)
      .values({ teacherId, name: "Room 12", schoolYear: "2026–27" })
      .returning();
    const [student] = await db
      .insert(students)
      .values({ teacherId, classId: klass.id, firstName, lastName: "K." })
      .returning();
    return student;
  }

  /** Walks a title from Ana's shelf to Ben's, returning the active loan. */
  async function lend(title = "Frog and Toad", isbn13: string | null = "9780064440202") {
    await connect();
    const { book } = await addBook(ana, title, { isbn13 });
    const { shelfLoanId } = await requestShelfLoan(db, ben, {
      ownerTeacherId: ana,
      bookId: book.id,
      message: "For my read-aloud shelf",
    });
    await approveShelfLoan(db, ana, shelfLoanId, { dueOn: "2026-12-01" });
    return { shelfLoanId, book };
  }

  describe("connections", () => {
    it("invites a teacher by email and connects once they accept", async () => {
      const { outcome, name } = await requestConnection(db, ana, "ben@school.test");
      expect(outcome).toBe("invited");
      expect(name).toBe("Ben Osei");
      expect(await areConnected(db, ana, ben)).toBe(false);

      const pending = await listConnections(db, ben);
      expect(pending.incoming).toHaveLength(1);
      expect(pending.incoming[0].name).toBe("Ana Ruiz");
      expect((await listConnections(db, ana)).outgoing).toHaveLength(1);

      await respondToConnection(db, ben, pending.incoming[0].connectionId, true);
      expect(await areConnected(db, ana, ben)).toBe(true);
      expect((await listConnections(db, ana)).peers[0].name).toBe("Ben Osei");
    });

    it("treats an invitation sent back as an acceptance", async () => {
      await requestConnection(db, ana, "ben@school.test");
      const { outcome } = await requestConnection(db, ben, "ana@school.test");
      expect(outcome).toBe("accepted_existing");
      expect(await areConnected(db, ana, ben)).toBe(true);
    });

    it("stores one row per pair however the invitation is sent", async () => {
      await connect();
      await expect(requestConnection(db, ben, "ana@school.test")).rejects.toThrow(ConflictError);
      await expect(requestConnection(db, ana, "ana@school.test")).rejects.toThrow(ConflictError);
      await expect(requestConnection(db, ana, "nobody@school.test")).rejects.toThrow(NotFoundError);
    });

    it("lets only the invited teacher answer, and declining removes the invitation", async () => {
      await requestConnection(db, ana, "ben@school.test");
      const { connectionId } = (await listConnections(db, ana)).outgoing[0];

      await expect(respondToConnection(db, ana, connectionId, true)).rejects.toThrow(NotFoundError);
      await respondToConnection(db, ben, connectionId, false);
      expect(await areConnected(db, ana, ben)).toBe(false);
      expect((await listConnections(db, ana)).outgoing).toHaveLength(0);
    });
  });

  describe("browsing a connected shelf", () => {
    it("refuses to show the shelf of a teacher who isn't connected", async () => {
      await addBook(ana, "Frog and Toad");
      await expect(browseShelf(db, ben, ana, {})).rejects.toThrow(NotFoundError);
    });

    it("shows lendable titles with the number of free copies", async () => {
      await connect();
      await addBook(ana, "Frog and Toad", { copyCount: 2 });
      await addBook(ana, "Class Set", { copyCount: 30, lendable: false });

      const shelf = await browseShelf(db, ben, ana, {});
      expect(shelf.items.map((item) => item.title)).toEqual(["Frog and Toad"]);
      expect(shelf.items[0].availableCopies).toBe(2);
      expect(shelf.items[0].standing).toBe("none");
    });

    it("leaves out copies a student already has", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad", { copyCount: 2 });
      const student = await addStudent(ana, "Ada");
      await checkOutBook(db, ana, { studentId: student.id, bookId: book.id, dueOn: null });

      const shelf = await browseShelf(db, ben, ana, {});
      expect(shelf.items[0].availableCopies).toBe(1);
    });

    it("marks titles this teacher has already asked for", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad");
      await requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null });

      const shelf = await browseShelf(db, ben, ana, {});
      expect(shelf.items[0].standing).toBe("requested");
    });
  });

  describe("lending a book out", () => {
    it("moves the book to the borrower's shelf and back again", async () => {
      const { shelfLoanId, book } = await lend();

      // Ana's copy is off her shelf but still hers.
      const [anaCopy] = await db.select().from(copies).where(eq(copies.bookId, book.id));
      expect(anaCopy.status).toBe("lent_out");
      expect(anaCopy.teacherId).toBe(ana);

      // Ben has a stand-in copy of his own to check out.
      const benBooks = await db.select().from(books).where(eq(books.teacherId, ben));
      expect(benBooks).toHaveLength(1);
      expect(benBooks[0].title).toBe("Frog and Toad");
      expect(benBooks[0].lendable).toBe(false);
      const benCopies = await db.select().from(copies).where(eq(copies.teacherId, ben));
      expect(benCopies).toHaveLength(1);
      expect(benCopies[0].status).toBe("in_circulation");

      await returnShelfLoan(db, ben, shelfLoanId);

      const [returned] = await db.select().from(copies).where(eq(copies.id, anaCopy.id));
      expect(returned.status).toBe("in_circulation");
      // Nothing of Ana's book is left behind in Ben's library.
      expect(await db.select().from(copies).where(eq(copies.teacherId, ben))).toHaveLength(0);
      expect(await db.select().from(books).where(eq(books.teacherId, ben))).toHaveLength(0);
    });

    it("keeps a lent-out copy out of the owner's own checkout", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad");
      const student = await addStudent(ana, "Ada");
      const { shelfLoanId } = await requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null });
      await approveShelfLoan(db, ana, shelfLoanId, { dueOn: null });

      const [found] = await findBooksToCheckOut(db, ana, "Frog");
      expect(found.available).toBe(0);
      await expect(
        checkOutBook(db, ana, { studentId: student.id, bookId: book.id, dueOn: null }),
      ).rejects.toThrow(ConflictError);
    });

    it("lets the borrower's students check the book out", async () => {
      const { shelfLoanId } = await lend();
      const student = await addStudent(ben, "Noor");
      const [benBook] = await db.select().from(books).where(eq(books.teacherId, ben));

      const loan = await checkOutBook(db, ben, { studentId: student.id, bookId: benBook.id, dueOn: null });
      expect(loan.studentName).toBe("Noor K.");

      await expect(returnShelfLoan(db, ben, shelfLoanId)).rejects.toThrow(ConflictError);

      await checkInLoan(db, ben, loan.loanId);
      await expect(returnShelfLoan(db, ben, shelfLoanId)).resolves.toBeDefined();
    });

    it("keeps the borrower's checkout history after the book goes home", async () => {
      const { shelfLoanId } = await lend();
      const student = await addStudent(ben, "Noor");
      const [benBook] = await db.select().from(books).where(eq(books.teacherId, ben));
      const loan = await checkOutBook(db, ben, { studentId: student.id, bookId: benBook.id, dueOn: null });
      await checkInLoan(db, ben, loan.loanId);

      await returnShelfLoan(db, ben, shelfLoanId);

      // The copy is withdrawn rather than deleted, so Noor's reading record survives.
      const benCopies = await db.select().from(copies).where(eq(copies.teacherId, ben));
      expect(benCopies).toHaveLength(1);
      expect(benCopies[0].status).toBe("withdrawn");
    });

    it("adds a copy to a title the borrower already owns instead of a second entry", async () => {
      await connect();
      const isbn13 = "9780064440202";
      await addBook(ben, "Frog and Toad", { isbn13 });
      const { book } = await addBook(ana, "Frog and Toad", { isbn13 });

      const { shelfLoanId } = await requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null });
      await approveShelfLoan(db, ana, shelfLoanId, { dueOn: null });

      expect(await db.select().from(books).where(eq(books.teacherId, ben))).toHaveLength(1);
      const benCopies = await db.select().from(copies).where(eq(copies.teacherId, ben));
      expect(benCopies.map((copy) => copy.copyNumber)).toEqual([1, 2]);

      await returnShelfLoan(db, ana, shelfLoanId);
      // Ben's own copy stays; only the borrowed one leaves.
      expect(await db.select().from(copies).where(eq(copies.teacherId, ben))).toHaveLength(1);
      expect(await db.select().from(books).where(eq(books.teacherId, ben))).toHaveLength(1);
    });

    it("never offers a borrowed book on to a third teacher", async () => {
      await lend();
      const cara = await createTeacher(db, "Cara Lin", "cara@school.test");
      await requestConnection(db, ben, "cara@school.test");
      const { incoming } = await listConnections(db, cara);
      await respondToConnection(db, cara, incoming[0].connectionId, true);

      const shelf = await browseShelf(db, cara, ben, {});
      expect(shelf.items).toHaveLength(0);
    });

    it("refuses a copy when every one is already out", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad");
      const student = await addStudent(ana, "Ada");
      await checkOutBook(db, ana, { studentId: student.id, bookId: book.id, dueOn: null });

      const { shelfLoanId } = await requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null });
      await expect(approveShelfLoan(db, ana, shelfLoanId, { dueOn: null })).rejects.toThrow(ConflictError);
    });
  });

  describe("requests", () => {
    it("lists a request on both sides and clears it when declined", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad");
      const { shelfLoanId } = await requestShelfLoan(db, ben, {
        ownerTeacherId: ana,
        bookId: book.id,
        message: "Please?",
      });

      const anaView = await listShelfLoans(db, ana, TODAY);
      expect(anaView.incoming).toHaveLength(1);
      expect(anaView.incoming[0].peerName).toBe("Ben Osei");
      expect(anaView.incoming[0].message).toBe("Please?");
      expect((await listShelfLoans(db, ben, TODAY)).outgoing).toHaveLength(1);

      await declineShelfLoan(db, ana, shelfLoanId);
      expect((await listShelfLoans(db, ana, TODAY)).incoming).toHaveLength(0);
      expect((await listShelfLoans(db, ben, TODAY)).outgoing).toHaveLength(0);
    });

    it("refuses a second request for the same title", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad", { copyCount: 2 });
      await requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null });
      await expect(
        requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null }),
      ).rejects.toThrow(ConflictError);
    });

    it("refuses a request for a book that isn't offered, or from a stranger", async () => {
      await connect();
      const { book } = await addBook(ana, "Class Set", { lendable: false });
      await expect(
        requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null }),
      ).rejects.toThrow(ConflictError);

      const cara = await createTeacher(db, "Cara Lin", "cara@school.test");
      const { book: open } = await addBook(ana, "Frog and Toad");
      await expect(
        requestShelfLoan(db, cara, { ownerTeacherId: ana, bookId: open.id, message: null }),
      ).rejects.toThrow(NotFoundError);
    });

    it("lets the borrower withdraw a request but not the owner's answer", async () => {
      await connect();
      const { book } = await addBook(ana, "Frog and Toad");
      const { shelfLoanId } = await requestShelfLoan(db, ben, { ownerTeacherId: ana, bookId: book.id, message: null });

      await expect(cancelShelfLoanRequest(db, ana, shelfLoanId)).rejects.toThrow(NotFoundError);
      await cancelShelfLoanRequest(db, ben, shelfLoanId);
      expect((await listShelfLoans(db, ana, TODAY)).incoming).toHaveLength(0);
    });

    it("marks an overdue loan against the borrower's agreed date", async () => {
      await lend();
      const view = await listShelfLoans(db, ben, "2026-12-25");
      expect(view.borrowed[0].overdue).toBe(true);
      expect(view.borrowed[0].peerName).toBe("Ana Ruiz");
      expect((await listShelfLoans(db, ana, "2026-10-01")).lentOut[0].overdue).toBe(false);
    });
  });

  describe("guards while a book is away", () => {
    it("won't let the owner delete or restatus a lent-out copy", async () => {
      const { book } = await lend();
      const [copy] = await db.select().from(copies).where(eq(copies.bookId, book.id));

      await expect(setCopyStatus(db, ana, copy.id, "lost")).rejects.toThrow(ConflictError);
      await expect(deleteCopy(db, ana, copy.id)).rejects.toThrow(ConflictError);
      await expect(deleteBook(db, ana, book.id)).rejects.toThrow(ConflictError);
      await expect(setBookLendable(db, ana, book.id, false)).rejects.toThrow(ConflictError);
    });

    it("won't let the borrower delete the stand-in copy", async () => {
      await lend();
      const [benBook] = await db.select().from(books).where(eq(books.teacherId, ben));
      const [benCopy] = await db.select().from(copies).where(eq(copies.teacherId, ben));

      await expect(deleteCopy(db, ben, benCopy.id)).rejects.toThrow(ConflictError);
      await expect(deleteBook(db, ben, benBook.id)).rejects.toThrow(ConflictError);
    });

    it("won't disconnect two teachers who still hold each other's books", async () => {
      const { shelfLoanId } = await lend();
      const { connectionId } = (await listConnections(db, ana)).peers[0];

      await expect(removeConnection(db, ana, connectionId)).rejects.toThrow(ConflictError);
      await returnShelfLoan(db, ana, shelfLoanId);
      await expect(removeConnection(db, ana, connectionId)).resolves.toBeUndefined();
      expect(await areConnected(db, ana, ben)).toBe(false);
    });
  });

  describe("tenant isolation", () => {
    it("refuses a shelf loan that points at a copy in the wrong library", async () => {
      await connect();
      const { book, copies: anaCopies } = await addBook(ana, "Frog and Toad");
      const { copies: benCopies } = await addBook(ben, "Something Else");

      // Ana's loan row claiming Ben's copy as her own is rejected by the composite key.
      await expect(
        db.insert(shelfLoans).values({
          ownerTeacherId: ana,
          borrowerTeacherId: ben,
          bookId: book.id,
          copyId: benCopies[0].id,
          status: "requested",
        }),
      ).rejects.toThrow();

      // And a stand-in copy that isn't really the borrower's is rejected too.
      await expect(
        db.insert(shelfLoans).values({
          ownerTeacherId: ana,
          borrowerTeacherId: ben,
          bookId: book.id,
          copyId: anaCopies[0].id,
          borrowerCopyId: anaCopies[0].id,
          status: "active",
        }),
      ).rejects.toThrow();
    });

    it("refuses a loan from a teacher to themselves", async () => {
      const { book, copies: anaCopies } = await addBook(ana, "Frog and Toad");
      await expect(
        db.insert(shelfLoans).values({
          ownerTeacherId: ana,
          borrowerTeacherId: ana,
          bookId: book.id,
          copyId: anaCopies[0].id,
          status: "requested",
        }),
      ).rejects.toThrow();
    });

    it("leaves the owner able to reclaim a copy when the borrower deletes their account", async () => {
      const { book } = await lend();

      await db.delete(user).where(eq(user.id, ben));

      // Ana keeps her copy; the loan record goes with Ben.
      const [copy] = await db.select().from(copies).where(eq(copies.bookId, book.id));
      expect(copy.teacherId).toBe(ana);
      expect(
        await db.select().from(shelfLoans).where(and(eq(shelfLoans.ownerTeacherId, ana), eq(shelfLoans.status, "active"))),
      ).toHaveLength(0);

      // With no loan left to guard it, she can put the copy back on her shelf herself.
      await setCopyStatus(db, ana, copy.id, "in_circulation");
      const [reclaimed] = await db.select().from(copies).where(eq(copies.id, copy.id));
      expect(reclaimed.status).toBe("in_circulation");
    });
  });
});
