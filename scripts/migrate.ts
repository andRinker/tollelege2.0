import { loadEnvConfig } from "@next/env";
import { closeDatabase, getDatabaseHandle } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";

async function main() {
  loadEnvConfig(process.cwd());
  const { kind } = getDatabaseHandle();
  console.info(`Applying migrations (${kind === "pg" ? "DATABASE_URL" : "local PGlite"})...`);
  await migrateDatabase();
  console.info("Migrations are up to date.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
