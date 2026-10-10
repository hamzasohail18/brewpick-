// Stage a CSV of prices or places for review.
//
//   npm run import:csv -- --type prices --source manual-admin path/to/prices.csv
//
// Needs DATABASE_URL. For the embedded dev database use the admin page (/admin/import) instead:
// two processes opening the same PGlite folder can corrupt it. Pass --pglite only with the dev server stopped.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { connectFromEnv } from "@/lib/db/connect";
import { SERVICE, withActor } from "@/lib/db/core";
import { CSV_TYPES, importCsv, type CsvType } from "@/lib/pipeline/csv-import";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { type: { type: "string" }, source: { type: "string", default: "manual-admin" }, pglite: { type: "boolean", default: false } },
});

async function main() {
  const type = values.type as CsvType;
  const file = positionals[0];
  if (!type || !(type in CSV_TYPES) || !file) {
    console.error(`Usage: npm run import:csv -- --type ${Object.keys(CSV_TYPES).join("|")} [--source <slug>] <file.csv>`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL && !values.pglite) {
    console.error("DATABASE_URL isn't set. Use /admin/import for the dev database, or stop the dev server and pass --pglite.");
    process.exit(2);
  }
  const { db } = await connectFromEnv();
  const result = await withActor(db, SERVICE, async (tx) => {
    const [source] = await tx.query<{ id: string }>("select id from sources where slug = $1", [values.source]);
    if (!source) throw new Error(`Unknown source "${values.source}"`);
    return importCsv(tx, { type, csv: readFileSync(file, "utf8"), sourceId: source.id });
  });
  for (const e of result.lineErrors) console.warn(`line ${e.line}: ${e.message}`);
  console.log(
    `Staged ${result.staged} for review · ${result.reconfirmed} re-confirmed · ${result.rejected} rejected by validator · ${result.lineErrors.length} unreadable lines`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
