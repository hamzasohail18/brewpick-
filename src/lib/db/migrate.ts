// Applies supabase/migrations (+ seeds) to a PGlite database. Real Supabase projects use the
// Supabase CLI instead (`npm run db:reset`); this exists for local dev without Docker and for tests.

import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SUPABASE_DIR = join(process.cwd(), "supabase");

function sqlFiles(dir: string) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      return { name, sql, hash: createHash("sha256").update(sql).digest("hex") };
    });
}

/**
 * Idempotent. Migrations run once each (tracked by filename). Seeds are idempotent by design and
 * re-run whenever their content changes.
 */
export async function migratePglite(pg: PGlite, opts: { seed?: boolean; root?: string } = {}) {
  const root = opts.root ?? SUPABASE_DIR;
  await pg.exec(`
    create schema if not exists app_meta;
    create table if not exists app_meta.applied (name text primary key, hash text not null, applied_at timestamptz default now());
  `);
  await pg.exec(readFileSync(join(root, "test", "supabase_shim.sql"), "utf8"));

  const applied = new Map(
    (await pg.query<{ name: string; hash: string }>("select name, hash from app_meta.applied")).rows.map((r) => [r.name, r.hash]),
  );

  for (const m of sqlFiles(join(root, "migrations"))) {
    if (applied.has(`migrations/${m.name}`)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("insert into app_meta.applied (name, hash) values ($1, $2)", [`migrations/${m.name}`, m.hash]);
    });
  }

  if (opts.seed === false) return;
  for (const s of sqlFiles(join(root, "seeds"))) {
    if (applied.get(`seeds/${s.name}`) === s.hash) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(s.sql);
      await tx.query(
        "insert into app_meta.applied (name, hash) values ($1, $2) on conflict (name) do update set hash = excluded.hash, applied_at = now()",
        [`seeds/${s.name}`, s.hash],
      );
    });
  }
}
