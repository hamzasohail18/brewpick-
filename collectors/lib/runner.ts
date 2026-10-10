// Every collector runs through runCollector(): it reads the source registry row, refuses to start
// unless the guard allows it, records a source_runs row, and hands the collector a fetch that obeys
// the source's policy. Collectors never write live tables; they stage records (Section 7.3).

import { SERVICE, withActor, type Db } from "@/lib/db/core";
import { assertCollectable, type CollectorPolicy } from "@/lib/domain/source-guard";
import type { SourceRow } from "@/lib/domain/sources";
import { createPoliteFetch, ServerBlockedError, type PoliteFetch, type PoliteFetchDeps } from "./polite-fetch";
import { localSnapshotStore, type SnapshotStore } from "./snapshots";

/**
 * APIs and open datasets are governed by their usage policy / licence (recorded in the registry
 * review), not robots.txt, which is aimed at crawlers. Websites and files always obey robots.txt.
 */
const API_KINDS = new Set(["open_data_api", "official_api", "reference_dataset", "social_official_api"]);

export interface CollectorContext {
  db: Db;
  source: SourceRow;
  policy: CollectorPolicy;
  runId: string;
  fetch: PoliteFetch;
  snapshots: SnapshotStore;
  log: (msg: string) => void;
}

export interface CollectorResult {
  found: number;
  staged: number;
  /** Set when some records failed but the run is still useful. */
  partial?: boolean;
  rawSnapshotUrl?: string | null;
}

export interface RunOptions {
  db: Db;
  slug: string;
  collect: (ctx: CollectorContext) => Promise<CollectorResult>;
  contactEmail?: string | null;
  fetchDeps?: PoliteFetchDeps;
  snapshots?: SnapshotStore;
  log?: (msg: string) => void;
  now?: Date;
}

export async function loadSource(db: Db, slug: string): Promise<SourceRow> {
  const [row] = await withActor(db, SERVICE, (tx) => tx.query<SourceRow>("select * from sources where slug = $1", [slug]));
  if (!row) throw new Error(`Unknown source "${slug}"`);
  return { ...row, rate_limit_seconds: Number(row.rate_limit_seconds) };
}

export async function runCollector(opts: RunOptions) {
  const log = opts.log ?? ((m: string) => console.log(`[${opts.slug}] ${m}`));
  const source = await loadSource(opts.db, opts.slug);

  // Throws CollectorBlockedError with reasons. No run row is written for a blocked attempt
  // (the database trigger would refuse it anyway).
  const policy = assertCollectable(source, {
    now: opts.now,
    contactEmail: opts.contactEmail ?? process.env.COLLECTOR_CONTACT_EMAIL ?? null,
  });

  const [{ id: runId }] = await withActor(opts.db, SERVICE, (tx) =>
    tx.query<{ id: string }>("insert into source_runs (source_id, status) values ($1, 'running') returning id", [source.id]),
  );
  log(`run ${runId} started`);

  const finish = (sql: string, params: unknown[]) =>
    withActor(opts.db, SERVICE, async (tx) => {
      await tx.query(sql, params);
      await tx.query(
        `update sources set last_checked_at = now(),
                next_check_at = now() + make_interval(days => check_interval_days)
          where id = $1`,
        [source.id],
      );
    });

  try {
    const result = await opts.collect({
      db: opts.db,
      source,
      policy,
      runId,
      fetch: createPoliteFetch(policy, { respectRobots: !API_KINDS.has(source.kind), ...opts.fetchDeps }),
      snapshots: opts.snapshots ?? localSnapshotStore(),
      log,
    });
    const status = result.partial ? "partial" : "succeeded";
    await finish(
      `update source_runs set status = $2, finished_at = now(), records_found = $3, records_staged = $4,
              raw_snapshot_url = $5 where id = $1`,
      [runId, status, result.found, result.staged, result.rawSnapshotUrl ?? null],
    );
    log(`run ${runId} ${status}: ${result.found} found, ${result.staged} staged`);
    return { runId, status, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish("update source_runs set status = 'failed', finished_at = now(), error_message = $2 where id = $1", [runId, message]);

    // Section 8.1: a block means set the source to not_allowed and stop until someone re-reviews it.
    if (err instanceof ServerBlockedError) {
      await withActor(opts.db, SERVICE, (tx) =>
        tx.query(
          `update sources set automation = 'not_allowed',
                  automation_notes = coalesce(automation_notes || E'\\n', '') || $2
            where id = $1`,
          [source.id, `[${new Date().toISOString().slice(0, 10)}] Auto-disabled by collector: ${message}`],
        ),
      );
      log(`source set to not_allowed after a ${err.status} response`);
    }
    throw err;
  }
}
