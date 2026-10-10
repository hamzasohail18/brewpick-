import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { AutomationBadge, ReviewBadge, RunBadge, StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listSources, parseFilters } from "@/lib/admin/sources-repo";
import { requireAdmin } from "@/lib/auth/session";
import { AUTOMATION_LABELS, KIND_LABELS, formatDate, formatDateTime } from "@/lib/domain/labels";
import { AUTOMATION_STATUSES, SOURCE_KINDS } from "@/lib/domain/sources";
import { nativeSelect } from "@/components/admin/native-select";

export const metadata: Metadata = { title: "Sources · BrewPick admin" };

export default async function SourcesPage({ searchParams }: PageProps<"/admin/sources">) {
  const admin = await requireAdmin("/admin/sources");
  const filters = parseFilters(await searchParams);
  const sources = await listSources(admin, filters);
  const all = filters.kind || filters.automation || filters.attention || filters.q ? await listSources(admin, {}) : sources;

  const needsReview = all.filter((s) => s.review === "needs_review").length;
  const overdue = all.filter((s) => s.review === "overdue").length;
  const runnable = all.filter((s) => s.review === "ok" && s.is_active && s.automation !== "not_allowed").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Source registry</h1>
          <p className="text-sm text-muted-foreground">
            Where every record comes from, and whether a collector may touch it.
          </p>
        </div>
        <Button asChild className="h-11">
          <Link href="/admin/sources/new">Add source</Link>
        </Button>
      </div>

      {(needsReview > 0 || overdue > 0) && (
        <Alert className="border-warning/60 bg-warning/10">
          <AlertTriangle aria-hidden className="text-warning" />
          <AlertTitle>
            {needsReview > 0 && `${needsReview} source${needsReview === 1 ? "" : "s"} not reviewed yet`}
            {needsReview > 0 && overdue > 0 && " · "}
            {overdue > 0 && `${overdue} overdue for 6-month re-review`}
          </AlertTitle>
          <AlertDescription>
            Collectors stay blocked until someone reads the robots.txt and terms and records the result.{" "}
            {!filters.attention && (
              <Link href="/admin/sources?attention=1" className="font-medium underline underline-offset-4">
                Show only these
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total", all.length],
          ["Not reviewed", needsReview],
          ["Overdue", overdue],
          ["Collectable", runnable],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end" role="search" aria-label="Filter sources">
        <div className="space-y-1">
          <label htmlFor="q" className="text-xs font-medium">
            Search
          </label>
          <Input id="q" name="q" defaultValue={filters.q} placeholder="Name or slug" className="h-11" />
        </div>
        <div className="space-y-1">
          <label htmlFor="kind" className="text-xs font-medium">
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={filters.kind ?? ""} className={nativeSelect}>
            <option value="">All kinds</option>
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="automation" className="text-xs font-medium">
            Automation
          </label>
          <select id="automation" name="automation" defaultValue={filters.automation ?? ""} className={nativeSelect}>
            <option value="">Any status</option>
            {AUTOMATION_STATUSES.map((a) => (
              <option key={a} value={a}>
                {AUTOMATION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="attention" value="1" defaultChecked={filters.attention} className="size-4" />
          Needs attention
        </label>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="h-11">
            Filter
          </Button>
          <Button asChild variant="ghost" className="h-11">
            <Link href="/admin/sources">Reset</Link>
          </Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <caption className="sr-only">Sources, {sources.length} shown</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Automation</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Next check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No sources match these filters.
                </TableCell>
              </TableRow>
            )}
            {sources.map((s) => (
              <TableRow key={s.id} className={s.is_active ? undefined : "opacity-60"}>
                <TableCell>
                  <Link href={`/admin/sources/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                    {s.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    <code>{s.slug}</code> · {KIND_LABELS[s.kind]}
                    {!s.is_active && " · inactive"}
                  </div>
                </TableCell>
                <TableCell>
                  <AutomationBadge value={s.automation} />
                </TableCell>
                <TableCell>
                  <ReviewBadge value={s.review} />
                  {s.robots_checked_at && <div className="mt-1 text-xs text-muted-foreground">{formatDate(s.robots_checked_at)}</div>}
                </TableCell>
                <TableCell>
                  {s.review === "not_applicable" ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : s.last_run_status ? (
                    <>
                      <RunBadge value={s.last_run_status} />
                      <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(s.last_run_at)}</div>
                    </>
                  ) : (
                    <StatusBadge tone="neutral">Never run</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {s.review === "not_applicable" ? "—" : formatDate(s.next_check_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
