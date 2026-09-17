import path from "node:path";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { getDatabaseHandle } from "./client";

export const migrationsFolder = path.join(process.cwd(), "drizzle");

export async function migrateDatabase(): Promise<void> {
  const handle = getDatabaseHandle();
  if (handle.kind === "pg") {
    await migrateNodePg(handle.db, { migrationsFolder });
  } else {
    await migratePglite(handle.db, { migrationsFolder });
  }
}
