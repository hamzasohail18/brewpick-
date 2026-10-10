import type { Metadata } from "next";
import Link from "next/link";
import { FlagBadge, StatusBadge } from "@/components/admin/status-badge";
import { nativeSelect } from "@/components/admin/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { listStaged, parseReviewFilters, TARGET_TABLES, type ReviewStatus } from "@/lib/admin/review-repo";
import { requireAdmin } from "@/lib/auth/session";
import { ACTION_LABELS, FLAG_LABELS, TABLE_LABELS, timeAgo } from "@/lib/domain/labels";
import { summarize } from "@/lib/pipeline/review-format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review queue · BrewPick admin" };

const TABS: { status: ReviewStatus; label: string }[] = [
  { status: "pending_review", label: "Pending" },
  { status: "published", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "archived", label: "Superseded" },
];

export default async function ReviewQueuePage({ searchParams }: PageProps<"/admin/review">) {
  const admin = await requireAdmin("/admin/review");
  const sp = await searchParams;
  const filters = parseReviewFilters(sp);
  const { rows, counts, flags } = await listStaged(admin, filters);
  const done = sp.done === "approved" || sp.done === "rejected" ? sp.done : null;

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { status: filters.status, table: filters.table, flag: filters.flag, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "status" && v === "pending_review")) q.set(k, v);
    const s = q.toString();
    return s ? `/admin/review?${s}` : "/admin/review";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Review queue</h1>
          <p className="text-sm text-muted-foreground">
            Collected and imported data waits here. Nothing goes live until it&apos;s approved.
          </p>
        </div>
        <Button asChild variant="secondary" className="h-11">
          <Link href="/admin/import">Import CSV</Link>
        </Button>
      </div>

      {done && (
        <Alert role="status" className="border-success/50 bg-success/10">
          <AlertDescription className="text-foreground">
            {done === "approved" ? "Approved and published." : "Rejected."} The queue is empty.
          </AlertDescription>
        </Alert>
      )}

      <nav aria-label="Status" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={href({ status: t.status, flag: undefined })}
            aria-current={filters.status === t.status ? "page" : undefined}
            className={cn(
              "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap",
              filters.status === t.status ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{counts[t.status] ?? 0}</span>
          </Link>
        ))}
      </nav>

      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" aria-label="Filter the queue">
        {filters.status !== "pending_review" && <input type="hidden" name="status" value={filters.status} />}
        <div className="space-y-1">
          <label htmlFor="table" className="text-xs font-medium">
            Type
          </label>
          <select id="table" name="table" defaultValue={filters.table ?? ""} className={nativeSelect}>
            <option value="">All types</option>
            {TARGET_TABLES.map((t) => (
              <option key={t} value={t}>
                {TABLE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="flag" className="text-xs font-medium">
            Flag
          </label>
          <select id="flag" name="flag" defaultValue={filters.flag ?? ""} className={nativeSelect}>
            <option value="">Any flag</option>
            {flags.map((f) => (
              <option key={f.flag} value={f.flag}>
                {FLAG_LABELS[f.flag]?.label ?? f.flag} ({f.n})
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" className="h-11">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {filters.status === "pending_review" ? (
            <>
              Nothing waiting for review.{" "}
              <Link href="/admin/import" className="underline underline-offset-4">
                Import a CSV
              </Link>{" "}
              or run a collector to add data.
            </>
          ) : (
            "No records here."
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/review/${r.id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge tone="neutral">
                    {TABLE_LABELS[r.target_table] ?? r.target_table} · {ACTION_LABELS[r.action]}
                  </StatusBadge>
                  <span>{r.source_name}</span>
                  <span aria-hidden>·</span>
                  <span>{timeAgo(r.created_at)}</span>
                </div>
                <div className="mt-2 font-medium">{summarize(r.proposed, r.current, r.diff)}</div>
                {r.place_name && r.target_table !== "places" && <div className="text-sm text-muted-foreground">{r.place_name}</div>}
                {(r.flags.length > 0 || r.review_note) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.flags.map((f) => (
                      <FlagBadge key={f} flag={f} />
                    ))}
                    {r.status !== "pending_review" && r.review_note && (
                      <span className="text-xs text-muted-foreground">{r.review_note}</span>
                    )}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
