import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";

export type TestDatabase = {
  db: Database;
  close: () => Promise<void>;
};

/** A fresh in-memory Postgres with all migrations applied. */
export async function createTestDb(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db: db as unknown as Database, close: () => client.close() };
}

/** Inserts a teacher account and returns its ID. */
export async function createTeacher(
  db: Database,
  name = "Test Teacher",
  email?: string,
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.user).values({
    id,
    name,
    email: email ?? `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}
