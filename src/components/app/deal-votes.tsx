"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount, voteDeal } from "@/lib/profile/client";

/** "Did this deal work for you?" Signed-in users vote; everyone sees the tallies. */
export function DealVotes({ dealId, upvotes, downvotes, reportHref }: { dealId: string; upvotes: number; downvotes: number; reportHref?: string }) {
  const account = useAccount();
  const pathname = usePathname();
  const [counts, setCounts] = useState({ upvotes, downvotes });
  const mine = account.dealVotes[dealId];
  const signedIn = account.status === "signedIn";

  const vote = async (v: boolean) => {
    const next = mine === v ? null : v;
    // Optimistic tallies; replaced by the server's numbers.
    setCounts((c) => ({
      upvotes: c.upvotes + (next === true ? 1 : 0) - (mine === true ? 1 : 0),
      downvotes: c.downvotes + (next === false ? 1 : 0) - (mine === false ? 1 : 0),
    }));
    const res = await voteDeal(dealId, next);
    if (res) setCounts(res);
    else setCounts({ upvotes, downvotes });
  };

  const btn = (v: boolean) => (
    <button
      type="button"
      aria-pressed={mine === v}
      disabled={!signedIn}
      onClick={() => void vote(v)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium disabled:opacity-60",
        mine === v ? (v ? "border-success bg-success/15 text-success" : "border-destructive bg-destructive/10 text-destructive") : "bg-card hover:bg-accent",
      )}
    >
      {v ? <ThumbsUp aria-hidden className="size-3.5" /> : <ThumbsDown aria-hidden className="size-3.5" />}
      {v ? "Worked" : "Didn't work"}
      <span className="tabular-nums">{v ? counts.upvotes : counts.downvotes}</span>
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-2">
      <span className="text-xs text-muted-foreground">Did it work for you?</span>
      {btn(true)}
      {btn(false)}
      {!signedIn && account.status !== "unknown" && (
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="inline-flex min-h-11 items-center text-xs underline underline-offset-2">
          Sign in to vote
        </Link>
      )}
      {reportHref && (
        <Link href={reportHref} className="ms-auto inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-2">
          Report
        </Link>
      )}
    </div>
  );
}
