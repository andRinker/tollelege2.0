export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Hosted databases are migrated by `npm run vercel-build`. Locally, keep PGlite up to date.
  if (process.env.DATABASE_URL) return;
  const { migrateDatabase } = await import("./db/migrate");
  await migrateDatabase();
}
