import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, type Database, getDatabaseHandle, getDb } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import { createBook } from "@/server/catalog";
import { checkInLoan, checkOutBook, circulationStats } from "@/server/circulation";
import { ConflictError } from "@/server/errors";
import { addStudent, createClass } from "@/server/roster";
import { createTeacher } from "../helpers/test-db";

// Production talks to Neon through `pg`, not PGlite. This runs the real DATABASE_URL code path
// against PGlite behind a Postgres wire-protocol socket, so no Docker or hosted database is needed.
describe("pg driver (DATABASE_URL)", () => {
  let pglite: PGlite;
  let server: PGLiteSocketServer;
  let db: Database;

  beforeAll(async () => {
    pglite = await PGlite.create();
    // One connection: PGlite runs a single session, so concurrent connections would share transactions.
    server = new PGLiteSocketServer({ db: pglite, port: 0, maxConnections: 1 });
    await server.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
    await migrateDatabase();
    db = getDb();
  });

  afterAll(async () => {
    await closeDatabase();
    delete process.env.DATABASE_URL;
    await server?.stop();
    await pglite?.close();
  });

  it("migrates and runs a checkout transaction over the wire", async () => {
    expect(getDatabaseHandle().kind).toBe("pg");

    const teacher = await createTeacher(db, "Wire Teacher");
    const klass = await createClass(db, teacher, { name: "Room 1", schoolYear: "2026–27" });
    const student = (await addStudent(db, teacher, klass.id, { firstName: "Pat", lastName: "Wire", studentNumber: null }))!;
    const { bookId } = await createBook(
      db,
      teacher,
      {
        isbn13: "9780064440202", title: "Frog and Toad Are Friends", subtitle: null, authors: ["Arnold Lobel"], description: null,
        coverUrl: null, publisher: null, publishedYear: 1970, pageCount: 64, readingLevel: null, tags: ["friendship"], location: null,
        notes: null, metadataSource: "manual",
      },
      1,
    );

    const loan = await checkOutBook(db, teacher, { studentId: student.id, bookId, dueOn: "2026-10-01" });
    expect(loan).toMatchObject({ copyNumber: 1, studentName: "Pat Wire", dueOn: "2026-10-01" });
    await expect(checkOutBook(db, teacher, { studentId: student.id, bookId, dueOn: null })).rejects.toBeInstanceOf(ConflictError);

    const stats = await circulationStats(db, teacher, "2026-09-17", "America/Chicago");
    expect(stats.booksOut).toBe(1);

    await checkInLoan(db, teacher, loan.loanId);
    expect((await circulationStats(db, teacher, "2026-09-17", "America/Chicago")).booksOut).toBe(0);
  });
});
