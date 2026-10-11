// Daily scheduler pass:   npm run scheduler            (needs DATABASE_URL)
//                         npm run scheduler -- --pglite (dev; stop the dev server first)
// Exits 1 when any collector failed, so a cron runner (GitHub Actions) reports it. Set ALERT_WEBHOOK_URL
// (Slack-compatible incoming webhook) to also get a message.

import { parseArgs } from "node:util";
import { runScheduler, sendAlert } from "@collectors/lib/scheduler";
import { connectFromEnv } from "@/lib/db/connect";

const { values } = parseArgs({ options: { pglite: { type: "boolean", default: false } } });

async function main() {
  if (!process.env.DATABASE_URL && !values.pglite) {
    console.error("DATABASE_URL isn't set. For the local PGlite database, stop the dev server and pass --pglite.");
    process.exit(2);
  }
  const { db } = await connectFromEnv();
  const report = await runScheduler({ db });
  for (const r of report.ran) console.log(`${r.slug}: ${r.status}${r.error ? ` (${r.error})` : ` ${r.found} found, ${r.staged} staged`}`);
  if (report.failures.length && process.env.ALERT_WEBHOOK_URL) {
    await sendAlert(process.env.ALERT_WEBHOOK_URL, report).catch((e) => console.error(`Alert failed: ${e instanceof Error ? e.message : e}`));
  }
  process.exit(report.failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
