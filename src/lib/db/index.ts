import "server-only";
import { connectFromEnv } from "./connect";
import { withActor, type Actor, type Db } from "./core";

export { ANON, SERVICE, type Actor, type Db } from "./core";

// One connection per server process; survives Next.js dev hot reloads.
const g = globalThis as unknown as { __brewpickDb?: Promise<{ db: Db; driver: "postgres" | "pglite" }> };

export function getDb() {
  g.__brewpickDb ??= connectFromEnv().catch((e) => {
    g.__brewpickDb = undefined; // retry on the next request instead of caching the failure
    throw e;
  });
  return g.__brewpickDb;
}

/** Run queries as `actor` so RLS applies exactly as it would for that user. */
export async function dbAs<T>(actor: Actor, fn: (tx: Db) => Promise<T>): Promise<T> {
  const { db } = await getDb();
  return withActor(db, actor, fn);
}
