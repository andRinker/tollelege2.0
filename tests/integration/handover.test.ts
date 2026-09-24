import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { books, classes, classTeachers, copies, handovers, loans, shelfLoans, students, user } from "@/db/schema";
import { createBook } from "@/server/catalog";
import { addCoTeacher, resolveClassroom } from "@/server/coteaching";
import { ConflictError, NotFoundError } from "@/server/errors";
import {
  acceptHandover,
  declineHandover,
  offerHandover,
  pendingHandoverFrom,
  pendingHandoversTo,
  withdrawHandover,
} from "@/server/handover";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const HATCHET = "9780689840920";
const WONDER = "9780375869020";
const HOLES = "9780440414803";

/**
 * Maria hands Room 12 and her "grade 5" books to Dan. Room 14 and Holes stay with her.
 * Dan already owns Wonder, so hers should join his title rather than make a second one.
 */
describe("handing over classes and books", () => {
  let testDb: TestDatabase;
  let db: Database;
  let maria: string;
  let dan: string;
  let room12: string;
  let room14: string;
  let ada: string; // Room 12
  let ben: string; // Room 12, student ID 100
  let cy: string; // Room 14
  let hatchet: { bookId: string; copyIds: string[] };
  let wonder: { bookId: string; copyIds: string[] };
  let holes: { bookId: string; copyIds: string[] };
  let dansWonder: { bookId: string; copyIds: string[] };

  const book = (isbn13: string, title: string, tags: string[], teacherId: string, count = 1) =>
    createBook(db, teacherId, {
      isbn13, title, subtitle: null, authors: [], description: null, coverUrl: null, publisher: null, publishedYear: null,
      pageCount: null, readingLevel: null, tags, location: null, notes: null, metadataSource: "manual",
    }, count);

  const loan = async (studentId: string, target: { bookId: string; copyIds: string[] }, copy: number, title: string, closed: boolean) => {
    const [row] = await db
      .insert(loans)
      .values({
        teacherId: maria,
        studentId,
        bookId: target.bookId,
        copyId: target.copyIds[copy],
        bookTitle: title,
        ...(closed ? { closedAt: new Date(), closeReason: "returned" as const } : {}),
      })
      .returning({ id: loans.id });
    return row.id;
  };

  const offer = (email = "dan@augprep.org") =>
    offerHandover(db, maria, { email, classIds: [room12], books: { kind: "tag", tag: "grade 5" } });

  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    maria = await createTeacher(db, "Maria Alvarez", "alvarez@augprep.org");
    dan = await createTeacher(db, "Dan Brooks", "dan@augprep.org");

    [{ id: room12 }, { id: room14 }] = await db
      .insert(classes)
      .values([
        { teacherId: maria, name: "Room 12", schoolYear: "2026–27" },
        { teacherId: maria, name: "Room 14", schoolYear: "2026–27" },
      ])
      .returning({ id: classes.id });
    [{ id: ada }, { id: ben }, { id: cy }] = await db
      .insert(students)
      .values([
        { teacherId: maria, classId: room12, firstName: "Ada", lastName: "King" },
        { teacherId: maria, classId: room12, firstName: "Ben", lastName: "Ortiz", studentNumber: "100" },
        { teacherId: maria, classId: room14, firstName: "Cy", lastName: "Park" },
      ])
      .returning({ id: students.id });

    hatchet = await book(HATCHET, "Hatchet", ["grade 5"], maria, 2);
    wonder = await book(WONDER, "Wonder", ["grade 5"], maria);
    holes = await book(HOLES, "Holes", [], maria);
    dansWonder = await book(WONDER, "Wonder", [], dan);
    return () => testDb.close();
  });

  describe("what stops it", () => {
    it("a book out with a child when the child and the book would part ways, and a student ID already taken", async () => {
      await loan(ada, holes, 0, "Holes", false); // Ada moves, Holes doesn't
      await loan(cy, hatchet, 1, "Hatchet", false); // Hatchet moves, Cy doesn't
      await loan(ben, hatchet, 0, "Hatchet", false); // both move: fine
      await db.insert(students).values({ teacherId: dan, firstName: "Zed", studentNumber: "100" });

      const outcome = await offer();
      expect(outcome).toEqual({
        status: "blocked",
        problems: [
          "Hatchet, copy 2, is checked out to Cy Park (Room 14), who isn't part of this hand-over. Check it in first.",
          "Ada King (Room 12) has Holes, copy 1, which isn't part of this hand-over. Check it in first.",
          "Ben Ortiz's student ID, 100, is already used by one of the other teacher's students. Change one of them first.",
        ],
      });
      expect(await db.select().from(handovers)).toHaveLength(0);
    });

    it("a book lent to, borrowed from, or asked for by another teacher", async () => {
      const eve = await createTeacher(db, "Eve Stone");
      const evesCopy = await book(HOLES, "Holes", [], eve);
      const standIn = await book("9780545010221", "Deathly Hallows", ["grade 5"], maria);
      await db.insert(shelfLoans).values([
        { ownerTeacherId: maria, borrowerTeacherId: eve, bookId: hatchet.bookId, copyId: hatchet.copyIds[0], borrowerCopyId: evesCopy.copyIds[0], status: "active" },
        { ownerTeacherId: eve, borrowerTeacherId: maria, bookId: evesCopy.bookId, copyId: evesCopy.copyIds[0], borrowerCopyId: standIn.copyIds[0], status: "active" },
        { ownerTeacherId: maria, borrowerTeacherId: eve, bookId: wonder.bookId, status: "requested" },
      ]);
      const outcome = await offer();
      expect(outcome.status === "blocked" && [...outcome.problems].sort()).toEqual([
        "Another teacher has asked to borrow Wonder. Answer the request first.",
        "Deathly Hallows is borrowed from another teacher. Send it back first.",
        "Hatchet is lent to another teacher. It has to come back first.",
      ]);
    });

    it("an address that isn't verified, yourself, or a second offer while one waits", async () => {
      await db.update(user).set({ emailVerified: false }).where(eq(user.id, dan));
      await expect(offer()).rejects.toThrow(/sign in with Google first/);
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, dan));
      await expect(offer("alvarez@augprep.org")).rejects.toBeInstanceOf(ConflictError);
      expect(await offer()).toMatchObject({ status: "sent", recipientName: "Dan Brooks", classes: 1, books: 2 });
      await expect(offer()).rejects.toThrow(/already have a hand-over waiting/);
    });
  });

  it("tells the recipient what's coming, and lets either side call it off", async () => {
    await offer();
    const [waiting] = await pendingHandoversTo(db, dan);
    expect(waiting).toMatchObject({ fromName: "Maria Alvarez", classNames: ["Room 12"], books: 2 });
    expect(await pendingHandoverFrom(db, maria)).toMatchObject({ toName: "Dan Brooks", toEmail: "dan@augprep.org" });

    await declineHandover(db, dan, waiting.id);
    expect(await pendingHandoversTo(db, dan)).toEqual([]);
    await expect(acceptHandover(db, dan, waiting.id)).rejects.toBeInstanceOf(NotFoundError);

    await offer();
    const [again] = await pendingHandoversTo(db, dan);
    await expect(withdrawHandover(db, dan, again.id)).rejects.toBeInstanceOf(NotFoundError); // not his to withdraw
    await withdrawHandover(db, maria, again.id);
    expect(await pendingHandoverFrom(db, maria)).toBeNull();
  });

  it("moves the classes, students, books and history, and keeps the old owner on as co-teacher", async () => {
    const eve = await createTeacher(db, "Eve Stone", "stone@augprep.org");
    await addCoTeacher(db, maria, room12, "stone@augprep.org"); // stays on under Dan
    await addCoTeacher(db, maria, room12, "dan@augprep.org"); // Dan can't co-teach his own class

    const benOut = await loan(ben, hatchet, 0, "Hatchet", false); // out, and both move
    const adaReadHatchet = await loan(ada, hatchet, 1, "Hatchet", true); // both move
    const benReadWonder = await loan(ben, wonder, 0, "Wonder", true); // both move, Wonder joins Dan's
    const adaReadHoles = await loan(ada, holes, 0, "Holes", true); // Ada moves, Holes stays
    const cyReadHatchet = await loan(cy, hatchet, 0, "Hatchet", true); // Hatchet moves, Cy stays

    await offer();
    const [waiting] = await pendingHandoversTo(db, dan);
    expect(await acceptHandover(db, dan, waiting.id)).toEqual({
      status: "accepted",
      fromName: "Maria Alvarez",
      classes: 1,
      books: 2,
      joined: 1,
    });

    const ownerOf = async (table: typeof classes | typeof students | typeof books, id: string) =>
      (await db.select({ teacherId: table.teacherId }).from(table).where(eq(table.id, id)))[0]?.teacherId;
    expect(await ownerOf(classes, room12)).toBe(dan);
    expect(await ownerOf(classes, room14)).toBe(maria);
    expect(await ownerOf(students, ada)).toBe(dan);
    expect(await ownerOf(students, cy)).toBe(maria);
    expect(await ownerOf(books, hatchet.bookId)).toBe(dan);
    expect(await ownerOf(books, holes.bookId)).toBe(maria);
    // Maria's Wonder became copy 2 of Dan's.
    expect(await ownerOf(books, wonder.bookId)).toBeUndefined();
    expect(await db.select({ bookId: copies.bookId, n: copies.copyNumber, teacherId: copies.teacherId }).from(copies).where(eq(copies.id, wonder.copyIds[0])))
      .toEqual([{ bookId: dansWonder.bookId, n: 2, teacherId: dan }]);

    const loanRow = async (id: string) =>
      (await db.select({ teacherId: loans.teacherId, bookId: loans.bookId, copyId: loans.copyId, open: sql<boolean>`${loans.closedAt} is null` }).from(loans).where(eq(loans.id, id)))[0];
    expect(await loanRow(benOut)).toEqual({ teacherId: dan, bookId: hatchet.bookId, copyId: hatchet.copyIds[0], open: true });
    expect(await loanRow(adaReadHatchet)).toEqual({ teacherId: dan, bookId: hatchet.bookId, copyId: hatchet.copyIds[1], open: false });
    expect(await loanRow(benReadWonder)).toEqual({ teacherId: dan, bookId: dansWonder.bookId, copyId: wonder.copyIds[0], open: false });
    // History that spans the split stays with the student and lets go of the book.
    expect(await loanRow(adaReadHoles)).toEqual({ teacherId: dan, bookId: null, copyId: null, open: false });
    expect(await loanRow(cyReadHatchet)).toEqual({ teacherId: maria, bookId: null, copyId: null, open: false });

    // Maria keeps working in Room 12, now as Dan's co-teacher; Eve stays on too.
    expect((await resolveClassroom(db, { teacherId: maria, name: "Maria Alvarez" }, dan)).classIds).toEqual([room12]);
    expect((await resolveClassroom(db, { teacherId: eve, name: "Eve Stone" }, dan)).classIds).toEqual([room12]);
    expect(await db.select().from(classTeachers).where(eq(classTeachers.coTeacherId, dan))).toEqual([]);
    expect((await db.select({ status: handovers.status }).from(handovers))[0].status).toBe("accepted");
  });

  it("checks everything again on accepting, and moves nothing if anything is in the way", async () => {
    await offer();
    const [waiting] = await pendingHandoversTo(db, dan);
    await loan(cy, hatchet, 0, "Hatchet", false); // went out after the offer

    expect(await acceptHandover(db, dan, waiting.id)).toMatchObject({ status: "blocked", problems: [expect.stringMatching(/Hatchet, copy 1/)] });
    expect((await db.select({ teacherId: classes.teacherId }).from(classes).where(eq(classes.id, room12)))[0].teacherId).toBe(maria);
    expect(await pendingHandoversTo(db, dan)).toHaveLength(1);
  });

  it("the database still refuses a half-done move when the transaction ends", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`set constraints all deferred`);
        // The book moves; its copies don't.
        await tx.update(books).set({ teacherId: dan }).where(and(eq(books.id, hatchet.bookId), eq(books.teacherId, maria)));
      }),
    ).rejects.toThrow();
    expect((await db.select({ teacherId: books.teacherId }).from(books).where(eq(books.id, hatchet.bookId)))[0].teacherId).toBe(maria);
  });
});
