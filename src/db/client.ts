import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;

/** Driver-agnostic database type. Transactions are assignable to it too. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export type DatabaseHandle =
  | { kind: "pg"; db: NodePgDatabase<Schema>; pool: Pool }
  | { kind: "pglite"; db: PgliteDatabase<Schema>; client: PGlite };

const globalForDb = globalThis as typeof globalThis & {
  __classroomLibraryDb?: DatabaseHandle;
};

/** Creates the connection on first use, so importing this module never opens a database. */
export function getDatabaseHandle(): DatabaseHandle {
  globalForDb.__classroomLibraryDb ??= createDatabaseHandle();
  return globalForDb.__classroomLibraryDb;
}

export function getDb(): Database {
  return getDatabaseHandle().db as unknown as Database;
}

export async function closeDatabase(): Promise<void> {
  const handle = globalForDb.__classroomLibraryDb;
  globalForDb.__classroomLibraryDb = undefined;
  if (!handle) return;
  if (handle.kind === "pg") await handle.pool.end();
  else await handle.client.close();
}

function createDatabaseHandle(): DatabaseHandle {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5_000 });
    // On Vercel Fluid compute, closes idle connections before the function suspends.
    attachDatabasePool(pool);
    return { kind: "pg", pool, db: drizzleNodePg({ client: pool, schema }) };
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Connect the Neon database to this Vercel project.");
  }
  const client = new PGlite(resolvePgliteDataDir());
  return { kind: "pglite", client, db: drizzlePglite({ client, schema }) };
}

/** Returns the PGlite directory, or undefined for an in-memory database. */
export function resolvePgliteDataDir(): string | undefined {
  // `next build` loads server modules in parallel workers; keep them away from the dev database.
  if (process.env.NEXT_PHASE === "phase-production-build") return undefined;
  const configured = process.env.PGLITE_DATA_DIR || ".data/pglite";
  if (configured === "memory://") return undefined;
  const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  mkdirSync(dir, { recursive: true });
  return dir;
}
