// Picks a driver from the environment. Shared by the Next.js server and Node scripts/collectors.
//   DATABASE_URL set  -> Postgres (Supabase). Use the direct or session-pooler connection string.
//   otherwise         -> PGlite persisted in PGLITE_DIR (default .data/pglite), auto-migrated + seeded.

import { pgliteDb, postgresDb, type Db } from "./core";

export async function connectFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<{ db: Db; driver: "postgres" | "pglite" }> {
  if (env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    // prepare: false keeps it compatible with Supabase's transaction pooler.
    const sql = postgres(env.DATABASE_URL, { prepare: false, max: Number(env.DATABASE_POOL_MAX ?? 5) });
    return { db: postgresDb(sql), driver: "postgres" };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { migratePglite } = await import("./migrate");
  const { mkdirSync } = await import("node:fs");
  const dir = env.PGLITE_DIR ?? ".data/pglite";
  mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await migratePglite(pg);
  return { db: pgliteDb(pg), driver: "pglite" };
}
