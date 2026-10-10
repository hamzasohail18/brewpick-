import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { AutomationBadge, ReviewBadge, RunBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSource } from "@/lib/admin/sources-repo";
import { requireAdmin } from "@/lib/auth/session";
import { KIND_LABELS, formatDate, formatDateTime } from "@/lib/domain/labels";
import { checkSource } from "@/lib/domain/source-guard";
import { isHumanEntry, reviewDueAt, reviewState } from "@/lib/domain/sources";
import { toFormDefaults } from "../form-defaults";
import { RunNowButton } from "../run-now";
import { SourceForm } from "../source-form";

export const metadata: Metadata = { title: "Source · BrewPick admin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SourceDetailPage({ params, searchParams }: PageProps<"/admin/sources/[id]">) {
  const { id } = await params;
  const admin = await requireAdmin(`/admin/sources/${id}`);
  if (!UUID.test(id)) notFound();
  const found = await getSource(admin, id);
  if (!found) notFound();
  const { source, runs, audit } = found;
  const created = (await searchParams).created === "1";

  const guard = checkSource(source, { contactEmail: process.env.COLLECTOR_CONTACT_EMAIL });
  const manual = isHumanEntry(source.kind);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/sources" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All sources
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{source.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <code>{source.slug}</code>
          <span>·</span>
          <span>{KIND_LABELS[source.kind]}</span>
          <AutomationBadge value={source.automation} />
          <ReviewBadge value={reviewState(source)} />
        </div>
        {created && (
          <Alert role="status" className="mt-4 border-success/50 bg-success/10">
            <AlertDescription className="text-foreground">Source created.</AlertDescription>
          </Alert>
        )}
      </div>

      <section aria-labelledby="collector-access" className="rounded-lg border bg-card p-4">
        <h2 id="collector-access" className="text-base font-semibold">
          Collector access
        </h2>
        {manual ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Manual-entry source. People enter this data through the admin, Menu Capture or submission forms; no collector
            runs against it.
          </p>
        ) : guard.allowed ? (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 aria-hidden className="size-4 text-success" />
              A collector may run, at most one request every {source.rate_limit_seconds}s. Next re-review due{" "}
              {formatDate(reviewDueAt(source.robots_checked_at!))}.
            </p>
            <RunNowButton id={source.id} disabled={false} />
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div id="guard-reasons" className="text-sm">
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert aria-hidden className="size-4 text-destructive" />
                Collectors are blocked for this source:
              </p>
              <ul className="mt-2 list-disc space-y-1 ps-6 text-muted-foreground">
                {guard.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <RunNowButton id={source.id} disabled describedBy="guard-reasons" />
          </div>
        )}
      </section>

      <SourceForm id={source.id} defaults={toFormDefaults(source)} />

      {!manual && (
        <section aria-labelledby="run-history" className="space-y-3">
          <h2 id="run-history" className="text-lg font-semibold">
            Run history
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Found</TableHead>
                    <TableHead className="text-right">Staged</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(r.started_at)}</TableCell>
                      <TableCell>
                        <RunBadge value={r.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.records_found ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.records_staged ?? "—"}</TableCell>
                      <TableCell className="max-w-md truncate text-sm text-muted-foreground" title={r.error_message ?? undefined}>
                        {r.error_message ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="change-history" className="space-y-3">
        <h2 id="change-history" className="text-lg font-semibold">
          Change history
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No edits recorded since it was seeded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="rounded-md border bg-card px-3 py-2">
                <span className="font-medium">{formatDateTime(a.created_at)}</span> · {a.actor_kind} {a.action}
                {a.new_values && (
                  <span className="text-muted-foreground"> · {Object.keys(a.new_values).join(", ") || "no changes"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
