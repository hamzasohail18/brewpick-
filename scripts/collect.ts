// Run one collector now:   npm run collect -- osm-overpass-lahore
// Same guard, run log and review queue as "Run now" in the admin. Needs DATABASE_URL, or --pglite with
// the dev server stopped (two processes must not open the same PGlite folder).

import { parseArgs } from "node:util";
import { COLLECTORS } from "@collectors/registry";
import { runCollector } from "@collectors/lib/runner";
import { connectFromEnv } from "@/lib/db/connect";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { pglite: { type: "boolean", default: false } } });

async function main() {
  const slug = positionals[0];
  if (!slug || !COLLECTORS[slug]) {
    console.error(`Usage: npm run collect -- <${Object.keys(COLLECTORS).join("|")}>`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL && !values.pglite) {
    console.error("DATABASE_URL isn't set. Use Run now in /admin/sources, or stop the dev server and pass --pglite.");
    process.exit(2);
  }
  const { db } = await connectFromEnv();
  const out = await runCollector({ db, slug, collect: COLLECTORS[slug] });
  console.log(`${out.status}: ${out.found} found, ${out.staged} staged for review`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
