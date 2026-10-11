"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_REASONS, type ReportReason } from "@/lib/community/types";

export function ReportForm({ placeSlug, target }: { placeSlug: string; target: { table: "places" | "deals"; id: string } }) {
  const reasons = (Object.keys(REPORT_REASONS) as ReportReason[]).filter((r) =>
    target.table === "deals" ? ["deal_not_honoured", "other"].includes(r) : r !== "deal_not_honoured",
  );
  const [reason, setReason] = useState<ReportReason | null>(target.table === "deals" ? "deal_not_honoured" : null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <div role="status" className="space-y-3 rounded-xl border border-success/40 bg-success/10 p-4">
        <p className="font-semibold">Thanks, we&apos;ll look into it.</p>
        <Button asChild variant="outline" className="h-11">
          <Link href={`/places/${placeSlug}`}>Back to the place</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return setError("Choose what's wrong.");
        setState("sending");
        setError(null);
        try {
          const res = await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_table: target.table, target_id: target.id, reason, details: details.trim() || null }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(body.error ?? `Couldn't send (${res.status})`);
          setState("done");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't send.");
          setState("idle");
        }
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What&apos;s wrong?</legend>
        {reasons.map((r) => (
          <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent">
            <input type="radio" name="reason" className="size-5 accent-primary" checked={reason === r} onChange={() => setReason(r)} />
            {REPORT_REASONS[r]}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Details <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-12 w-full text-base" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send report"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Got a photo of the right price, hours or deal?{" "}
        <Link href={`/places/${placeSlug}/suggest`} className="underline underline-offset-2">
          Suggest a correction
        </Link>{" "}
        instead, and it can go live sooner.
      </p>
    </form>
  );
}
