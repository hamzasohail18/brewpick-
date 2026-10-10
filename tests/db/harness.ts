import { PGlite } from "@electric-sql/pglite";
import { migratePglite } from "@/lib/db/migrate";

/**
 * Fresh in-memory Postgres with the Supabase shim, all migrations and (optionally) seeds applied.
 * The fictional sample data is left out unless asked for, so tests control their own fixtures.
 */
export async function freshDb({ seed = true, sample = false } = {}): Promise<PGlite> {
  const db = new PGlite();
  await migratePglite(db, { seed, seedFilter: (f) => sample || !f.includes("sample") });
  return db;
}

/** Run `fn` as a Supabase role with the given JWT claims, inside a rolled-back transaction. */
export async function asRole<T>(
  db: PGlite,
  role: "anon" | "authenticated",
  claims: Record<string, unknown>,
  fn: (tx: Pick<PGlite, "query" | "exec">) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${role}`);
    const out = await fn(tx);
    await tx.rollback();
    return out;
  });
}
