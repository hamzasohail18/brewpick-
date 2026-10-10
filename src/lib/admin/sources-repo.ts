import "server-only";
import { dbAs } from "@/lib/db";
import type { UserActor } from "@/lib/auth/session";
import {
  AUTOMATION_STATUSES,
  SOURCE_KINDS,
  reviewState,
  type AutomationStatus,
  type ReviewState,
  type SourceFormValues,
  type SourceKind,
  type SourceRow,
  type SourceRunRow,
} from "@/lib/domain/sources";

export interface SourceListItem extends SourceRow {
  review: ReviewState;
  last_run_status: SourceRunRow["status"] | null;
  last_run_at: Date | null;
}

export interface SourceFilters {
  kind?: SourceKind;
  automation?: AutomationStatus;
  attention?: boolean;
  q?: string;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): SourceFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const kind = one("kind");
  const automation = one("automation");
  return {
    kind: SOURCE_KINDS.includes(kind as SourceKind) ? (kind as SourceKind) : undefined,
    automation: AUTOMATION_STATUSES.includes(automation as AutomationStatus) ? (automation as AutomationStatus) : undefined,
    attention: one("attention") === "1",
    q: one("q")?.trim() || undefined,
  };
}

/** Compare a stored value with a form value (dates and numerics come back from the driver in other shapes). */
function same(a: unknown, b: unknown) {
  const norm = (v: unknown) =>
    v instanceof Date ? v.toISOString() : v === null || v === undefined || v === "" ? null : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return norm(a) === norm(b);
}

const normalize = <T extends { rate_limit_seconds: unknown }>(r: T) => ({ ...r, rate_limit_seconds: Number(r.rate_limit_seconds) });

export async function listSources(actor: UserActor, f: SourceFilters, now = new Date()): Promise<SourceListItem[]> {
  const rows = await dbAs(actor, (tx) =>
    tx.query<SourceRow & { last_run_status: SourceRunRow["status"] | null; last_run_at: Date | null }>(
      `select s.*, r.status as last_run_status, r.started_at as last_run_at
         from sources s
         left join lateral (
           select status, started_at from source_runs where source_id = s.id order by started_at desc limit 1
         ) r on true
        where ($1::source_kind is null or s.kind = $1)
          and ($2::automation_status is null or s.automation = $2)
          and ($3::text is null or s.name ilike '%' || $3 || '%' or s.slug ilike '%' || $3 || '%')
        order by s.kind, s.slug`,
      [f.kind ?? null, f.automation ?? null, f.q ?? null],
    ),
  );
  const items = rows.map((r) => ({ ...normalize(r), review: reviewState(r, now) }));
  return f.attention ? items.filter((s) => s.review === "needs_review" || s.review === "overdue") : items;
}

export async function getSource(actor: UserActor, id: string) {
  return dbAs(actor, async (tx) => {
    const [source] = await tx.query<SourceRow>("select * from sources where id = $1", [id]);
    if (!source) return null;
    const runs = await tx.query<SourceRunRow>(
      "select * from source_runs where source_id = $1 order by started_at desc limit 20",
      [id],
    );
    const audit = await tx.query<{ id: number; actor_kind: string; action: string; created_at: Date; new_values: Record<string, unknown> | null }>(
      "select id, actor_kind, action, created_at, new_values from audit_log where table_name = 'sources' and record_id = $1 order by created_at desc limit 10",
      [id],
    );
    return { source: normalize(source), runs, audit };
  });
}

const COLUMNS = [
  "slug",
  "name",
  "kind",
  "base_url",
  "place_id",
  "automation",
  "automation_notes",
  "tos_url",
  "robots_checked_at",
  "license",
  "attribution_required",
  "attribution_text",
  "cache_allowed",
  "max_cache_days",
  "rate_limit_seconds",
  "user_agent",
  "default_confidence",
  "check_interval_days",
  "is_active",
] as const satisfies readonly (keyof SourceFormValues)[];

/** Insert or update a source and write an audit_log row in the same transaction. */
export async function saveSource(actor: UserActor, id: string | null, v: SourceFormValues): Promise<string> {
  const values = COLUMNS.map((c) => v[c]);
  return dbAs(actor, async (tx) => {
    let before: SourceRow | null = null;
    let savedId: string;
    if (id) {
      [before] = await tx.query<SourceRow>("select * from sources where id = $1 for update", [id]);
      if (!before) throw new Error("Source not found");
      const set = COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await tx.query(`update sources set ${set} where id = $1`, [id, ...values]);
      savedId = id;
    } else {
      const cols = COLUMNS.join(", ");
      const params = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
      [{ id: savedId }] = await tx.query<{ id: string }>(
        `insert into sources (${cols}, next_check_at) values (${params}, now()) returning id`,
        values,
      );
    }
    const changed = before
      ? Object.fromEntries(COLUMNS.filter((c) => !same(before![c], v[c])).map((c) => [c, v[c]]))
      : v;
    await tx.query(
      `insert into audit_log (actor_id, actor_kind, table_name, record_id, action, old_values, new_values, source_id)
       values ($1, 'admin', 'sources', $2, $3, $4, $5, $2)`,
      [
        actor.userId,
        savedId,
        before ? "update" : "insert",
        before ? JSON.stringify(Object.fromEntries(Object.keys(changed).map((k) => [k, before![k as keyof SourceRow]]))) : null,
        JSON.stringify(changed),
      ],
    );
    return savedId;
  });
}

/** Queues a run. The executor (build step 12) picks queued runs up; the DB trigger re-checks the guard. */
export async function queueRun(actor: UserActor, sourceId: string) {
  return dbAs(actor, async (tx) => {
    const [run] = await tx.query<{ id: string }>(
      "insert into source_runs (source_id, status) values ($1, 'queued') returning id",
      [sourceId],
    );
    return run.id;
  });
}

export async function attributions() {
  return dbAs({ kind: "anon" }, (tx) =>
    tx.query<{ name: string; license: string | null; attribution_text: string; base_url: string | null }>(
      "select name, license, attribution_text, base_url from v_attributions order by name",
    ),
  );
}
