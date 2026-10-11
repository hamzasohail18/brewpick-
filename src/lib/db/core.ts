// Database access without framework dependencies, so the app, scripts, collectors and tests share it.
// Two drivers: Postgres (DATABASE_URL, e.g. Supabase) and PGlite (local dev + tests, no Docker).

import type { PGlite, Transaction } from "@electric-sql/pglite";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` in a transaction. Nested calls reuse the outer transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** Who is acting. Decides which Postgres role (and therefore which RLS policies) a query runs under. */
export type Actor =
  | { kind: "anon" }
  | { kind: "user"; userId: string; isAdmin: boolean; email?: string | null; /** app_metadata.role, e.g. "volunteer" */ role?: string | null }
  /** Server-side jobs (collectors, publisher). Bypasses RLS: never derive this from a request. */
  | { kind: "service" };

export const ANON: Actor = { kind: "anon" };
export const SERVICE: Actor = { kind: "service" };

/** Supabase-shaped JWT claims for an actor, as read by auth.uid() / auth.jwt() in the policies. */
export function claimsFor(actor: Actor): Record<string, unknown> {
  if (actor.kind !== "user") return { role: "anon" };
  return {
    sub: actor.userId,
    role: "authenticated",
    app_metadata: actor.isAdmin ? { role: "admin" } : {},
  };
}

/** Run `fn` as `actor`: sets the role and JWT claims for the duration of one transaction. */
export async function withActor<T>(db: Db, actor: Actor, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (actor.kind !== "service") {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claimsFor(actor))]);
      await tx.query(actor.kind === "user" ? "set local role authenticated" : "set local role anon");
    }
    return fn(tx);
  });
}

// ---------- PGlite ----------

export function pgliteDb(pg: PGlite | Transaction): Db {
  const isTx = !("transaction" in pg);
  const db: Db = {
    async query<T>(sql: string, params?: unknown[]) {
      return (await pg.query<T>(sql, params)).rows;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (isTx) return fn(db);
      return (pg as PGlite).transaction((tx) => fn(pgliteDb(tx)));
    },
  };
  return db;
}

// ---------- Postgres (postgres.js) ----------

type PostgresSql = import("postgres").Sql;
type PostgresTx = import("postgres").TransactionSql;

export function postgresDb(sql: PostgresSql | PostgresTx, inTx = false): Db {
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (inTx) return fn(db);
      return (sql as PostgresSql).begin((tx) => fn(postgresDb(tx, true))) as Promise<T>;
    },
  };
  return db;
}
