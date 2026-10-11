import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { flaggedDeals, listClaims, listReports, listSubmissions, moderationCounts } from "@/lib/community/actions";
import { REPORT_REASONS, SUBMISSION_TYPE_LABELS, type ReportReason, type SubmissionType } from "@/lib/community/types";
import { timeAgo } from "@/lib/domain/labels";
import { safeHttp } from "@/lib/explore/links";
import { cn } from "@/lib/utils";
import { claimAction, dealAction, reportAction, submissionAction } from "./actions";

export const metadata: Metadata = { title: "Moderation · BrewPick admin" };

const TABS = [
  { id: "reports", label: "Reports" },
  { id: "claims", label: "Owner claims" },
  { id: "deals", label: "Disputed deals" },
  { id: "submissions", label: "Submissions" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<string, string> = { pending_review: "In review", published: "Live / handled", rejected: "Not used", archived: "Replaced" };

export default async function ModerationPage({ searchParams }: PageProps<"/admin/moderation">) {
  const admin = await requireAdmin("/admin/moderation");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "reports";
  const counts = await dbAs(admin, (tx) => moderationCounts(tx));
  const badge: Record<Tab, number> = { reports: counts.reports, claims: counts.claims, deals: counts.deals, submissions: counts.submissions };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Moderation</h1>
        <p className="text-sm text-muted-foreground">
          Price, menu, deal and hours suggestions go to the{" "}
          <Link href="/admin/review?flag=community" className="underline underline-offset-2">
            review queue
          </Link>{" "}
          with their photos (owner updates are flagged <em>owner update</em>). This page handles the rest.
        </p>
      </div>
      {typeof sp.error === "string" && (
        <Alert variant="destructive">
          <AlertDescription>{sp.error}</AlertDescription>
        </Alert>
      )}
      {sp.done && (
        <Alert role="status" className="border-success/50 bg-success/10">
          <AlertDescription className="text-foreground">Done.</AlertDescription>
        </Alert>
      )}
      <nav aria-label="Moderation" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/moderation?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn("flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap", tab === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground")}
          >
            {t.label}
            {badge[t.id] > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">{badge[t.id]}</span>}
          </Link>
        ))}
      </nav>
      {tab === "reports" && <Reports admin={admin} />}
      {tab === "claims" && <Claims admin={admin} />}
      {tab === "deals" && <Deals admin={admin} />}
      {tab === "submissions" && <Submissions admin={admin} />}
    </div>
  );
}

type Admin = Awaited<ReturnType<typeof requireAdmin>>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
const NoteInput = ({ placeholder, required }: { placeholder: string; required?: boolean }) => (
  <Input name="note" placeholder={placeholder} required={required} maxLength={500} className="h-11 min-w-48 flex-1" />
);

async function Reports({ admin }: { admin: Admin }) {
  const rows = await dbAs(admin, (tx) => listReports(tx, "open"));
  if (!rows.length) return <Empty>No open reports.</Empty>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={String(r.id)} className="space-y-2 rounded-xl border p-4">
          <p className="font-medium">{REPORT_REASONS[r.reason as ReportReason] ?? String(r.reason)}</p>
          <p className="text-sm text-muted-foreground">
            {r.deal_title ? `Deal “${String(r.deal_title)}” at ` : ""}
            {r.place_slug ? (
              <Link href={`/places/${String(r.place_slug)}`} className="underline underline-offset-2">
                {String(r.place_name)}
              </Link>
            ) : (
              "(no longer listed)"
            )}{" "}
            · {timeAgo(r.created_at as Date)}
          </p>
          {r.details ? <p className="rounded-md bg-muted p-2 text-sm">{String(r.details)}</p> : null}
          <form action={reportAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={String(r.id)} />
            <NoteInput placeholder="What you did (optional)" />
            <Button type="submit" name="outcome" value="resolved" className="h-11">
              Fixed
            </Button>
            <Button type="submit" name="outcome" value="dismissed" variant="outline" className="h-11">
              Dismiss
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}

async function Claims({ admin }: { admin: Admin }) {
  const rows = await dbAs(admin, (tx) => listClaims(tx, "pending"));
  if (!rows.length) return <Empty>No claims waiting.</Empty>;
  const METHOD: Record<string, string> = { phone_call: "Call the cafe", business_email: "Business email", document: "Document" };
  return (
    <ul className="space-y-3">
      {rows.map((c) => (
        <li key={String(c.id)} className="space-y-2 rounded-xl border p-4">
          <p className="font-medium">
            <Link href={`/places/${String(c.place_slug)}`} className="underline underline-offset-2">
              {String(c.place_name)}
              {c.branch_name ? ` · ${String(c.branch_name)}` : ""}
            </Link>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Verify by</dt>
            <dd>{METHOD[String(c.verification_method)] ?? String(c.verification_method)}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{String(c.contact_name ?? "—")}</dd>
            <dt className="text-muted-foreground">Phone</dt>
            <dd>
              {String(c.contact_phone ?? "—")}
              {c.listed_phone ? <span className="text-muted-foreground"> (listed number: {String(c.listed_phone)})</span> : null}
            </dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>
              {String(c.contact_email ?? "—")}
              {c.website_url ? <span className="text-muted-foreground"> (cafe site: {String(c.website_url)})</span> : null}
            </dd>
            {c.note ? (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd>{String(c.note)}</dd>
              </>
            ) : null}
            {c.document_url ? (
              <>
                <dt className="text-muted-foreground">Document</dt>
                <dd>
                  <a href={new URL(String(c.document_url)).pathname} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    Open (private)
                  </a>
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{timeAgo(c.created_at as Date)}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Check independently: call the number listed for the cafe (not one given in the claim), or email the cafe&apos;s own domain.
          </p>
          {c.owned_by_other ? <p className="text-sm text-destructive">This place already has an owner. Approving will fail until that is removed.</p> : null}
          <form action={claimAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={String(c.id)} />
            <NoteInput placeholder="Note (required to reject)" />
            <Button type="submit" name="decision" value="approve" className="h-11">
              Verified: approve
            </Button>
            <Button type="submit" name="decision" value="reject" variant="outline" className="h-11">
              Reject
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}

async function Deals({ admin }: { admin: Admin }) {
  const rows = await dbAs(admin, (tx) => flaggedDeals(tx));
  if (!rows.length) return <Empty>No deals with more &ldquo;didn&apos;t work&rdquo; than &ldquo;worked&rdquo; votes (minimum 3).</Empty>;
  return (
    <ul className="space-y-3">
      {rows.map((d) => (
        <li key={String(d.id)} className="space-y-2 rounded-xl border p-4">
          <p className="font-medium">{String(d.title)}</p>
          <p className="text-sm text-muted-foreground">
            {d.place_slug ? (
              <Link href={`/places/${String(d.place_slug)}#deals`} className="underline underline-offset-2">
                {String(d.place_name)}
              </Link>
            ) : (
              String(d.place_name)
            )}{" "}
            · 👍 {Number(d.upvotes)} · 👎 {Number(d.downvotes)}
          </p>
          <form action={dealAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={String(d.id)} />
            <NoteInput placeholder="Why it's coming down (required)" required />
            <Button type="submit" variant="destructive" className="h-11">
              Take the deal down
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">If the deal still runs, leave it; check the bank or cafe first.</p>
        </li>
      ))}
    </ul>
  );
}

async function Submissions({ admin }: { admin: Admin }) {
  const rows = await dbAs(admin, (tx) => listSubmissions(tx, null));
  if (!rows.length) return <Empty>No submissions yet.</Empty>;
  return (
    <ul className="divide-y rounded-xl border">
      {rows.map((s) => {
        const payload = s.payload as { message?: string };
        const isOther = s.type === "other";
        return (
          <li key={String(s.id)} className="space-y-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {SUBMISSION_TYPE_LABELS[s.type as SubmissionType]} ·{" "}
                {s.place_slug ? (
                  <Link href={`/places/${String(s.place_slug)}`} className="underline underline-offset-2">
                    {String(s.place_name)}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
              <span className="text-xs text-muted-foreground">
                {STATUS_LABEL[String(s.status)] ?? String(s.status)} · {timeAgo(s.created_at as Date)}
              </span>
            </div>
            {isOther && payload.message ? <p className="rounded-md bg-muted p-2 text-sm">{payload.message}</p> : null}
            {s.note ? <p className="text-sm text-muted-foreground">Note: {String(s.note)}</p> : null}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {safeHttp(s.proof_image_url as string) && (
                <a href={safeHttp(s.proof_image_url as string)!} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Photo
                </a>
              )}
              {s.first_staged_id ? (
                <Link href={`/admin/review/${String(s.first_staged_id)}`} className="underline underline-offset-2">
                  {Number(s.pending_staged) > 0 ? "Review it" : "See in review queue"}
                </Link>
              ) : null}
            </div>
            {isOther && s.status === "pending_review" && (
              <form action={submissionAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={String(s.id)} />
                <NoteInput placeholder="Note to the sender (optional)" />
                <Button type="submit" name="decision" value="accept" className="h-11">
                  Acted on it
                </Button>
                <Button type="submit" name="decision" value="reject" variant="outline" className="h-11">
                  Not needed
                </Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
