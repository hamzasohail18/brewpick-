import "server-only";
import { dbAs } from "@/lib/db";
import type { UserActor } from "@/lib/auth/session";
import type { FieldDiff } from "@/lib/pipeline/diff";

export const REVIEW_STATUSES = ["pending_review", "published", "rejected", "archived"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const TARGET_TABLES = ["item_prices", "places", "nutrition_info", "deals", "bean_info"] as const;

export interface StagedRow {
  id: string;
  source_id: string;
  source_name: string;
  source_slug: string;
  source_run_id: string | null;
  target_table: string;
  target_id: string | null;
  action: "create" | "update" | "delete" | "reconfirm";
  proposed: Record<string, unknown>;
  current: Record<string, unknown> | null;
  diff: FieldDiff | null;
  flags: string[];
  messages: string[];
  evidence_url: string | null;
  status: ReviewStatus | "draft";
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  place_name: string | null;
}

export interface ReviewFilters {
  status: ReviewStatus;
  table?: string;
  flag?: string;
}

export function parseReviewFilters(sp: Record<string, string | string[] | undefined>): ReviewFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = one("status");
  const table = one("table");
  return {
    status: REVIEW_STATUSES.includes(status as ReviewStatus) ? (status as ReviewStatus) : "pending_review",
    table: TARGET_TABLES.includes(table as (typeof TARGET_TABLES)[number]) ? table : undefined,
    flag: one("flag")?.trim() || undefined,
  };
}

const SELECT = `
  select r.*, s.name as source_name, s.slug as source_slug,
         coalesce(p.name || coalesce(' (' || p.branch_name || ')', ''), r.proposed->>'name') as place_name
    from staging_records r
    join sources s on s.id = r.source_id
    left join places p on p.id = case when r.proposed->>'place_id' ~ '^[0-9a-f-]{36}$' then (r.proposed->>'place_id')::uuid end`;

export async function listStaged(actor: UserActor, f: ReviewFilters, limit = 100) {
  return dbAs(actor, async (tx) => {
    const rows = await tx.query<StagedRow>(
      `${SELECT}
        where r.status = $1::record_status
          and ($2::text is null or r.target_table = $2)
          and ($3::text is null or $3 = any(r.flags))
        order by case when r.status = 'pending_review' then r.created_at end asc,
                 coalesce(r.reviewed_at, r.created_at) desc
        limit $4`,
      [f.status, f.table ?? null, f.flag ?? null, limit],
    );
    const counts = await tx.query<{ status: ReviewStatus; n: number }>(
      "select status, count(*)::int as n from staging_records group by status",
    );
    const flags = await tx.query<{ flag: string; n: number }>(
      `select unnest(flags) as flag, count(*)::int as n from staging_records where status = 'pending_review'
        group by 1 order by 2 desc`,
    );
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<ReviewStatus, number>>, flags };
  });
}

export async function getStaged(actor: UserActor, id: string) {
  return dbAs(actor, async (tx) => {
    const [row] = await tx.query<StagedRow>(`${SELECT} where r.id = $1`, [id]);
    if (!row) return null;
    // Oldest other pending record, so a reviewer can work through the queue without going back to the list.
    const [next] = await tx.query<{ id: string }>(
      "select id from staging_records where status = 'pending_review' and id <> $1 order by created_at limit 1",
      [id],
    );
    return { row, nextId: next?.id ?? null };
  });
}

export async function pendingCount(actor: UserActor) {
  const [r] = await dbAs(actor, (tx) =>
    tx.query<{ n: number }>("select count(*)::int as n from staging_records where status = 'pending_review'"),
  );
  return r.n;
}
