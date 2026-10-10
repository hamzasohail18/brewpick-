import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../supabase", import.meta.url));

function sqlFiles(dir: string): string[] {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(root, dir, f), "utf8"));
}

/** Fresh in-memory Postgres with the Supabase shim, all migrations and all seeds applied. */
export async function freshDb({ seed = true } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(root, "test", "supabase_shim.sql"), "utf8"));
  for (const sql of sqlFiles("migrations")) await db.exec(sql);
  if (seed) for (const sql of sqlFiles("seeds")) await db.exec(sql);
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
