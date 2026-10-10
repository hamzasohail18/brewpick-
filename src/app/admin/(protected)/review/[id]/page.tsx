import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, ImageOff } from "lucide-react";
import { FlagBadge, StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getStaged } from "@/lib/admin/review-repo";
import { requireAdmin } from "@/lib/auth/session";
import { ACTION_LABELS, FLAG_LABELS, TABLE_LABELS, formatDateTime } from "@/lib/domain/labels";
import type { RecordKind } from "@/lib/pipeline/records";
import { comparisonRows, summarize, toEditableFields } from "@/lib/pipeline/review-format";
import { cn } from "@/lib/utils";
import { ReviewActions } from "../review-actions";

export const metadata: Metadata = { title: "Review · BrewPick admin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksLikeImage = (url: string) => /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);

export default async function ReviewItemPage({ params, searchParams }: PageProps<"/admin/review/[id]">) {
  const { id } = await params;
  const admin = await requireAdmin(`/admin/review/${id}`);
  if (!UUID.test(id)) notFound();
  const found = await getStaged(admin, id);
  if (!found) notFound();
  const { row, nextId } = found;
  const done = (await searchParams).done;

  const kind = row.proposed.kind as RecordKind | "item_price_removal";
  const isRemoval = row.action === "delete";
  const rows = isRemoval ? [] : comparisonRows(kind as RecordKind, row.proposed, row.current, row.diff);
  const pending = row.status === "pending_review";
  // Informational flags (new item, assumed volume) don't need the warning box.
  const needsCare = row.messages.length > 0 || row.flags.some((f) => (FLAG_LABELS[f]?.tone ?? "warn") !== "neutral");
  // Only ever link to http(s); evidence URLs come from collectors and imports.
  const evidence = row.evidence_url && /^https?:\/\//i.test(row.evidence_url) ? row.evidence_url : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/review" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Review queue
        </Link>
        {done && (
          <Alert role="status" className="mt-3 border-success/50 bg-success/10">
            <AlertDescription className="text-foreground">
              {done === "approved" ? "Approved and published." : "Rejected."} Here&apos;s the next one.
            </AlertDescription>
          </Alert>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge tone="neutral">
            {TABLE_LABELS[row.target_table] ?? row.target_table} · {ACTION_LABELS[row.action]}
          </StatusBadge>
          {!pending && (
            <StatusBadge tone={row.status === "published" ? "ok" : row.status === "rejected" ? "bad" : "neutral"}>
              {row.status === "published" ? "Approved" : row.status === "rejected" ? "Rejected" : "Superseded"}
            </StatusBadge>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-semibold">{summarize(row.proposed, row.current, row.diff)}</h1>
        {row.place_name && row.target_table !== "places" && <p className="text-muted-foreground">{row.place_name}</p>}
      </div>

      {!needsCare && row.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {row.flags.map((f) => (
            <FlagBadge key={f} flag={f} />
          ))}
        </div>
      )}
      {needsCare && (
        <section aria-labelledby="checks" className="space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-4">
          <h2 id="checks" className="text-sm font-semibold">
            Check before approving
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {row.flags.map((f) => (
              <FlagBadge key={f} flag={f} />
            ))}
          </div>
          {row.messages.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-sm">
              {row.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="evidence" className="space-y-3">
          <h2 id="evidence" className="text-lg font-semibold">
            Evidence
          </h2>
          {evidence && looksLikeImage(evidence) ? (
            <a href={evidence} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external proof images */}
              <img src={evidence} alt="Proof photo submitted with this record" className="max-h-[70vh] w-full object-contain" referrerPolicy="no-referrer" />
            </a>
          ) : evidence ? (
            <a
              href={evidence}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-card p-4 hover:bg-accent/50"
            >
              <span className="min-w-0">
                <span className="block font-medium">Open the source page</span>
                <span className="block truncate text-sm text-muted-foreground">{evidence}</span>
              </span>
              <ExternalLink aria-hidden className="size-4 shrink-0" />
            </a>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <ImageOff aria-hidden className="size-4" /> No evidence attached.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Source</dt>
            <dd>
              <Link href={`/admin/sources/${row.source_id}`} className="underline-offset-4 hover:underline">
                {row.source_name}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Staged</dt>
            <dd>{formatDateTime(row.created_at)}</dd>
            {row.reviewed_at && (
              <>
                <dt className="text-muted-foreground">Reviewed</dt>
                <dd>{formatDateTime(row.reviewed_at)}</dd>
              </>
            )}
            {row.review_note && (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd>{row.review_note}</dd>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="values" className="space-y-3">
          <h2 id="values" className="text-lg font-semibold">
            Values
          </h2>
          {isRemoval ? (
            <p className="rounded-lg border bg-card p-4 text-sm">
              The source&apos;s latest full menu no longer lists this item. Approving archives the menu item; its price history is kept.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <caption className="sr-only">Live values compared with the proposed values</caption>
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Field
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Live now
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Proposed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.field} className={cn("border-b last:border-0", r.changed && "bg-warning/10")}>
                      <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                        {r.field}
                      </th>
                      <td className="px-3 py-2 tabular-nums">{r.live}</td>
                      <td className={cn("px-3 py-2 tabular-nums", r.changed && "font-semibold")}>
                        {r.proposed}
                        {r.changed && <span className="ms-2 text-xs font-normal text-muted-foreground">(changed)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {pending && (
        <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <ReviewActions
            id={row.id}
            nextId={nextId}
            fields={isRemoval ? [] : toEditableFields(row.proposed)}
            original={JSON.stringify(row.proposed)}
            canEdit={!isRemoval}
          />
        </div>
      )}
    </div>
  );
}
