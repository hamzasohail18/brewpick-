// The scheduler pass (Section 7.4), run daily by .github/workflows/scheduled-collect.yml or by hand with
// `npm run scheduler`:
//   1. archive published deals whose valid_to has passed (Asia/Karachi date)
//   2. start runs queued from "Run now" (COLLECTOR_EXECUTION=queue)
//   3. run every collectable source that is due: next_check_at reached (check_interval_days: menus 14,
//      deals 1, places 30 in the registry), or weekly for sources tied to the 20 most-favourited places
//   4. report failures (exit code + optional Slack-compatible webhook)
// One source at a time, so each source's own rate limit is the only pacing that matters.

import { SERVICE, withActor, type Db } from "@/lib/db/core";
import { checkSource } from "@/lib/domain/source-guard";
import type { SourceRow } from "@/lib/domain/sources";
import { karachiDate } from "@/lib/pipeline/normalize";
import { collectorFor, type Collector } from "../registry";
import { runCollector } from "./runner";

export const POPULAR_PLACES = 20;
export const POPULAR_INTERVAL_DAYS = 7;
const DAY_MS = 86_400_000;

type DueInput = Pick<SourceRow, "place_id" | "last_checked_at" | "next_check_at">;

/** Pure: is this (collectable) source due for a run? */
export function isDue(s: DueInput, now: Date, popularPlaceIds: ReadonlySet<string>): boolean {
  if (!s.last_checked_at) return true;
  if (!s.next_check_at || s.next_check_at <= now) return true;
  return !!s.place_id && popularPlaceIds.has(s.place_id) && now.getTime() - s.last_checked_at.getTime() >= POPULAR_INTERVAL_DAYS * DAY_MS;
}

export interface SchedulerOptions {
  db: Db;
  now?: Date;
  contactEmail?: string | null;
  /** Override for tests. */
  collectorFor?: (s: SourceRow) => Collector | null;
  log?: (msg: string) => void;
}

export interface SchedulerReport {
  dealsArchived: number;
  ran: { slug: string; status: string; found?: number; staged?: number; error?: string }[];
  skippedBlocked: number;
  failures: string[];
}

export async function expireDeals(db: Db, today: string): Promise<number> {
  return withActor(db, SERVICE, async (tx) => {
    const ended = await tx.query<{ id: string; valid_to: string }>(
      "update deals set status = 'archived' where status = 'published' and valid_to < $1::date returning id, valid_to::text",
      [today],
    );
    for (const d of ended) {
      await tx.query(
        `insert into audit_log (actor_id, actor_kind, table_name, record_id, action, old_values, new_values)
         values (null, 'bot', 'deals', $1, 'expire', '{"status":"published"}', $2)`,
        [d.id, JSON.stringify({ status: "archived", note: `Ended ${d.valid_to}` })],
      );
    }
    return ended.length;
  });
}

export async function runScheduler(opts: SchedulerOptions): Promise<SchedulerReport> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((m: string) => console.log(`[scheduler] ${m}`));
  const pick = opts.collectorFor ?? collectorFor;
  const contactEmail = opts.contactEmail ?? process.env.COLLECTOR_CONTACT_EMAIL ?? null;
  const report: SchedulerReport = { dealsArchived: 0, ran: [], skippedBlocked: 0, failures: [] };

  report.dealsArchived = await expireDeals(opts.db, karachiDate(now));
  if (report.dealsArchived) log(`archived ${report.dealsArchived} ended deal(s)`);

  const { sources, queued, popular } = await withActor(opts.db, SERVICE, async (tx) => ({
    sources: (await tx.query<SourceRow>("select * from sources order by slug")).map((s) => ({ ...s, rate_limit_seconds: Number(s.rate_limit_seconds) })),
    queued: await tx.query<{ id: string; source_id: string }>("select id, source_id from source_runs where status = 'queued' order by started_at"),
    popular: new Set(
      (
        await tx.query<{ place_id: string }>(
          "select place_id from favorites group by place_id order by count(*) desc, place_id limit $1",
          [POPULAR_PLACES],
        )
      ).map((r) => r.place_id),
    ),
  }));

  const run = async (source: SourceRow, collect: Collector, queuedRunId?: string) => {
    try {
      const out = await runCollector({ db: opts.db, slug: source.slug, collect, contactEmail, queuedRunId, now, log: (m) => log(`${source.slug}: ${m}`) });
      report.ran.push({ slug: source.slug, status: out.status, found: out.found, staged: out.staged });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      report.ran.push({ slug: source.slug, status: "failed", error });
      report.failures.push(`${source.slug}: ${error}`);
    }
  };

  const handled = new Set<string>();
  for (const q of queued) {
    const source = sources.find((s) => s.id === q.source_id);
    if (!source || handled.has(source.id)) continue;
    handled.add(source.id);
    const collect = pick(source);
    const decision = checkSource(source, { now, contactEmail });
    if (!collect || !decision.allowed) {
      const why = !collect ? "No collector for this source." : decision.reasons.join(" ");
      await withActor(opts.db, SERVICE, (tx) =>
        tx.query("update source_runs set status = 'failed', finished_at = now(), error_message = $2 where id = $1", [q.id, why]),
      );
      report.failures.push(`${source.slug}: queued run not started: ${why}`);
      continue;
    }
    await run(source, collect, q.id);
  }

  for (const source of sources) {
    if (handled.has(source.id)) continue;
    const collect = pick(source);
    if (!collect || !source.is_active) continue;
    // Blocked sources are waiting on a human review, not failing; they're counted, not alerted.
    if (!checkSource(source, { now, contactEmail }).allowed) {
      report.skippedBlocked++;
      continue;
    }
    if (!isDue(source, now, popular)) continue;
    await run(source, collect);
  }

  log(`done: ${report.ran.length} run(s), ${report.failures.length} failure(s), ${report.skippedBlocked} source(s) waiting for review`);
  return report;
}

/** Posts a short failure summary to a Slack-compatible incoming webhook ({ text }). */
export async function sendAlert(webhookUrl: string, report: SchedulerReport, fetchImpl: typeof fetch = fetch) {
  const text = [`BrewPick collectors: ${report.failures.length} failure(s)`, ...report.failures.map((f) => `• ${f.slice(0, 300)}`)].join("\n");
  const res = await fetchImpl(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Alert webhook returned ${res.status}`);
}
