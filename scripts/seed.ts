import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { closeDatabase, getDb, getDatabaseHandle } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";
import { account, copies, loans, students, user } from "../src/db/schema";
import { addDays, schoolYearLabel, todayInTimeZone } from "../src/lib/dates";
import { isValidIsbn13 } from "../src/lib/isbn";
import { createBook } from "../src/server/catalog";
import { createClass, importStudents } from "../src/server/roster";
import { updateTeacherSettings } from "../src/server/settings";

// Demo data for local development: one teacher, two classes, a shelf of books, and a
// realistic spread of loans (returned, due soon, due today, overdue, lost). No network.
//
//   npm run db:seed              local PGlite (stop `npm run dev` first; PGlite allows one process)
//   npm run db:seed -- --remote  a DATABASE_URL database; never use this on production

const DEMO_EMAIL = "demo@tollelege.test";
const DEMO_PASSWORD = "take-and-read";
const TIME_ZONE = "America/Chicago";

const CLASSES = {
  "Room 12": [
    "Matilda Wormwood", "Charlie Bucket", "Ramona Quimby", "Stanley Yelnats", "Meg Murry",
    "Jess Aarons", "Leslie Burke", "Opal Buloni", "Fern Arable", "Milo Tock",
  ],
  "Room 14": [
    "Peter Hatcher", "Brian Robeson", "Annemarie Johansen", "Esperanza Ortega", "Karana Island",
    "August Pullman", "Jonas Giver", "Billy Colman", "Ralph Mouse", "Despereaux Tilling",
  ],
};

type SeedBook = [isbn13: string | null, title: string, authors: string[], year: number, pages: number, level: string, tags: string[], copies: number];

const BOOKS: SeedBook[] = [
  ["9780064440202", "Frog and Toad Are Friends", ["Arnold Lobel"], 1970, 64, "K", ["friendship", "early reader"], 2],
  ["9780064400558", "Charlotte's Web", ["E. B. White"], 1952, 184, "R", ["animals", "classic"], 3],
  ["9780439708180", "Harry Potter and the Sorcerer's Stone", ["J. K. Rowling"], 1998, 309, "V", ["fantasy", "series"], 2],
  ["9780375869020", "Wonder", ["R. J. Palacio"], 2012, 315, "V", ["realistic fiction", "kindness"], 3],
  ["9780440414803", "Holes", ["Louis Sachar"], 1998, 233, "V", ["mystery", "humor"], 2],
  ["9780061992254", "The One and Only Ivan", ["Katherine Applegate"], 2012, 305, "S", ["animals"], 2],
  ["9781416936473", "Hatchet", ["Gary Paulsen"], 1987, 195, "R", ["adventure", "survival"], 2],
  [null, "Because of Winn-Dixie", ["Kate DiCamillo"], 2000, 182, "R", ["animals", "realistic fiction"], 2],
  ["9780142410370", "Matilda", ["Roald Dahl"], 1988, 240, "S", ["humor", "classic"], 1],
  ["9780142410318", "Charlie and the Chocolate Factory", ["Roald Dahl"], 1964, 176, "R", ["humor", "classic"], 2],
  ["9780316381994", "The Wild Robot", ["Peter Brown"], 2016, 279, "S", ["science fiction", "animals"], 3],
  ["9780440412670", "Where the Red Fern Grows", ["Wilson Rawls"], 1961, 245, "U", ["animals", "classic"], 1],
  ["9780312367541", "A Wrinkle in Time", ["Madeleine L'Engle"], 1962, 232, "W", ["science fiction", "classic"], 1],
  ["9780064401845", "Bridge to Terabithia", ["Katherine Paterson"], 1977, 163, "T", ["friendship", "classic"], 1],
  [null, "The Tale of Despereaux", ["Kate DiCamillo"], 2003, 267, "T", ["fantasy", "animals"], 1],
  [null, "Number the Stars", ["Lois Lowry"], 1989, 137, "U", ["historical fiction"], 2],
  [null, "Island of the Blue Dolphins", ["Scott O'Dell"], 1960, 184, "R", ["historical fiction", "survival"], 1],
  [null, "The Phantom Tollbooth", ["Norton Juster"], 1961, 256, "U", ["fantasy", "humor"], 1],
  ["9780810993136", "Diary of a Wimpy Kid", ["Jeff Kinney"], 2007, 217, "T", ["humor", "series", "graphic novel"], 3],
  ["9780142408810", "Tales of a Fourth Grade Nothing", ["Judy Blume"], 1972, 120, "Q", ["humor", "realistic fiction"], 2],
  ["9780380709564", "Ramona Quimby, Age 8", ["Beverly Cleary"], 1981, 190, "O", ["realistic fiction", "series"], 2],
  ["9780380709243", "The Mouse and the Motorcycle", ["Beverly Cleary"], 1965, 158, "O", ["animals", "fantasy"], 1],
  ["9780064404990", "The Lion, the Witch and the Wardrobe", ["C. S. Lewis"], 1950, 206, "T", ["fantasy", "series", "classic"], 2],
  ["9780439120425", "Esperanza Rising", ["Pam Muñoz Ryan"], 2000, 262, "V", ["historical fiction"], 1],
  ["9780544107717", "The Crossover", ["Kwame Alexander"], 2014, 237, "U", ["sports", "poetry"], 2],
];

const BINS = ["Bin A", "Bin B", "Bin C", "Top shelf", "Reading nook"];

/** Small deterministic PRNG so every seed run produces the same library. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const { kind } = getDatabaseHandle();
  if (kind === "pg" && !process.argv.includes("--remote")) {
    throw new Error("DATABASE_URL is set. Seeding a hosted database needs --remote, and should never target production.");
  }

  await migrateDatabase();
  const db = getDb();
  const rand = random(12);
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];

  // Start over: deleting the user cascades to all of their data.
  await db.delete(user).where(eq(user.email, DEMO_EMAIL));
  const teacherId = randomUUID();
  await db.insert(user).values({ id: teacherId, name: "Rae Delgado", email: DEMO_EMAIL, emailVerified: true });
  await db.insert(account).values({
    id: randomUUID(),
    userId: teacherId,
    accountId: teacherId,
    providerId: "credential",
    password: await hashPassword(DEMO_PASSWORD),
  });

  const today = todayInTimeZone(TIME_ZONE);
  await updateTeacherSettings(db, teacherId, {
    timeZone: TIME_ZONE,
    loanPeriodDays: 14,
    maxBooksPerStudent: 3,
    readingLevelSystem: "guided_reading",
  });

  for (const [name, roster] of Object.entries(CLASSES)) {
    const klass = await createClass(db, teacherId, { name, schoolYear: schoolYearLabel(today) });
    await importStudents(
      db,
      teacherId,
      klass.id,
      roster.map((full) => {
        const [firstName, ...rest] = full.split(" ");
        return { firstName, lastName: rest.join(" "), studentNumber: null };
      }),
    );
  }
  const studentIds = (await db.select({ id: students.id }).from(students).where(eq(students.teacherId, teacherId))).map((row) => row.id);

  const copyIds: string[] = [];
  for (const [isbn13, title, authors, year, pages, level, tags, copyCount] of BOOKS) {
    if (isbn13 && !isValidIsbn13(isbn13)) throw new Error(`Seed ISBN for ${title} is invalid: ${isbn13}`);
    const created = await createBook(
      db,
      teacherId,
      {
        isbn13,
        title,
        subtitle: null,
        authors,
        description: null,
        coverUrl: null,
        publisher: null,
        publishedYear: year,
        pageCount: pages,
        readingLevel: level,
        tags,
        location: pick(BINS),
        notes: null,
        metadataSource: "manual",
      },
      copyCount,
    );
    copyIds.push(...created.copyIds);
  }

  // Loans. Checkout times are mid-morning in the teacher's time zone (15:00 UTC is 10 AM in Chicago).
  const at = (daysAgo: number) => new Date(`${addDays(today, -daysAgo)}T15:00:00Z`);
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const shuffledCopies = [...copyIds].sort(() => rand() - 0.5);
  const openCounts = new Map<string, number>();
  const borrower = () => {
    for (;;) {
      const studentId = pick(studentIds);
      if ((openCounts.get(studentId) ?? 0) < 3) return studentId;
    }
  };

  const history: Array<typeof loans.$inferInsert> = [];
  // Returned books from the last two months.
  for (let i = 0; i < 36; i++) {
    const daysAgo = 8 + Math.floor(rand() * 55);
    const keptFor = Math.min(3 + Math.floor(rand() * 12), daysAgo - 2);
    history.push({
      teacherId,
      copyId: pick(copyIds),
      studentId: pick(studentIds),
      checkedOutAt: at(daysAgo),
      dueOn: addDays(addDays(today, -daysAgo), 14),
      closedAt: at(daysAgo - keptFor),
      closeReason: "returned",
    });
  }
  // Returned yesterday and earlier today.
  history.push(
    { teacherId, copyId: pick(copyIds), studentId: pick(studentIds), checkedOutAt: at(9), dueOn: addDays(today, 5), closedAt: at(1), closeReason: "returned" },
    { teacherId, copyId: pick(copyIds), studentId: pick(studentIds), checkedOutAt: at(12), dueOn: addDays(today, 2), closedAt: minutesAgo(35), closeReason: "returned" },
  );

  // Books out now, by when they were checked out. Loans are 14 days.
  const current: Array<[daysAgo: number | "today", minutes?: number]> = [
    [20], [18], [17], [15], // overdue
    [14], [14], // due today
    [13], [11], [9], [7], [6], [4], [2], [1],
    ["today", 50], ["today", 20],
  ];
  for (const [daysAgo, minutes] of current) {
    const studentId = borrower();
    openCounts.set(studentId, (openCounts.get(studentId) ?? 0) + 1);
    const checkoutDay = daysAgo === "today" ? today : addDays(today, -daysAgo);
    history.push({
      teacherId,
      copyId: shuffledCopies.pop()!,
      studentId,
      checkedOutAt: daysAgo === "today" ? minutesAgo(minutes ?? 10) : at(daysAgo),
      dueOn: addDays(checkoutDay, 14),
    });
  }

  // One book that never came back.
  const lostCopy = shuffledCopies.pop()!;
  history.push({ teacherId, copyId: lostCopy, studentId: pick(studentIds), checkedOutAt: at(40), dueOn: addDays(today, -26), closedAt: at(3), closeReason: "lost" });

  await db.insert(loans).values(history);
  await db.update(copies).set({ status: "lost" }).where(eq(copies.id, lostCopy));

  console.info(`Seeded ${kind === "pg" ? "DATABASE_URL" : "local PGlite"}:`);
  console.info(`  ${BOOKS.length} titles, ${copyIds.length} copies, ${studentIds.length} students in ${Object.keys(CLASSES).length} classes`);
  console.info(`  ${current.length} books out, ${history.length} loans in all`);
  console.info(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
