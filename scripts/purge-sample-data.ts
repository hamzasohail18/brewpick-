// Remove all fictional sample data:   npm run sample:purge
// Needs DATABASE_URL (or --pglite with the dev server stopped). The /admin/import page has a button too.

import { parseArgs } from "node:util";
import { connectFromEnv } from "@/lib/db/connect";
import { SERVICE, withActor } from "@/lib/db/core";

const { values } = parseArgs({ options: { pglite: { type: "boolean", default: false } } });

async function main() {
  if (!process.env.DATABASE_URL && !values.pglite) {
    console.error("DATABASE_URL isn't set. Use the button on /admin/import, or stop the dev server and pass --pglite.");
    process.exit(2);
  }
  const { db } = await connectFromEnv();
  const [r] = await withActor(db, SERVICE, (tx) => tx.query<{ result: Record<string, number> }>("select purge_sample_data() as result"));
  console.log("Removed sample data:", r.result);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
