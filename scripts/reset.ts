import { rmSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { closeDatabase, resolvePgliteDataDir } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";

// Deletes the local PGlite database and recreates it. Refuses to touch a hosted database.
async function main() {
  loadEnvConfig(process.cwd());
  if (process.env.DATABASE_URL) {
    throw new Error("db:reset only works on the local PGlite database. Unset DATABASE_URL first.");
  }
  const dir = resolvePgliteDataDir();
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    console.info(`Deleted ${dir}`);
  }
  await migrateDatabase();
  console.info("Local database recreated. Run `npm run db:seed` for demo data.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
