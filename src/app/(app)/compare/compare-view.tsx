"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2, MessageCircle, Plus, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nativeSelect } from "@/components/admin/native-select";
import { cn } from "@/lib/utils";
import { compareHref, MAX_COMPARE, type CompareSelection } from "@/lib/compare/params";
import type { CompareResult } from "@/lib/compare/repo";
import { CardsButton } from "@/components/app/cards-sheet";
import { CompareTable } from "./compare-table";

export function CompareView({
  result,
  selection,
  drinks,
  shareText,
  shareUrl,
}: {
  result: CompareResult;
  selection: CompareSelection;
  drinks: { slug: string; name: string }[];
  shareText: string;
  /** Absolute link to this comparison (built on the server so it renders the same on both sides). */
  shareUrl: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const removeHref = (key: string) =>
    compareHref({
      items: selection.items.filter((i) => i !== key),
      places: selection.places.filter((p) => `place:${p}` !== key),
      drink: selection.drink ?? result.drink?.slug ?? null,
    });

  const share = async () => {
    const url = shareUrl;
    if (navigator.share) {
      try {
        await navigator.share({ title: "BrewPick comparison", text: shareText, url });
        return;
      } catch {
        // cancelled or unsupported: fall back to copying the link
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  const count = result.columns.length;

  return (
    <div className="space-y-4">
      {selection.places.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 font-medium">Drink</span>
          <select
            className={cn(nativeSelect, "h-11")}
            value={result.drink?.slug ?? ""}
            onChange={(e) => router.push(compareHref({ ...selection, drink: e.target.value }), { scroll: false })}
          >
            {drinks.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {count === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          None of these could be found. They may have been removed.
        </p>
      ) : (
        <>
          {count === 1 && <p className="text-sm text-muted-foreground">Add at least one more to see what stands out.</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Prices after deals use the cards and apps you have.</p>
            <CardsButton compact />
          </div>
          <CompareTable columns={result.columns} deals={result.deals} removeHref={removeHref} />
          <p className="text-xs text-muted-foreground">
            ✓ marks the best value in a row. A dash means we don&apos;t know the value; it never counts as best.
            {selection.places.length > 0 && " For each place we compare the size closest to a regular cup (350 ml)."}
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {count < MAX_COMPARE && (
          <Button asChild variant="outline" className="h-11">
            <Link href="/explore">
              <Plus aria-hidden />
              Add more
            </Link>
          </Button>
        )}
        {count >= 2 && (
          <>
            <Button className="h-11" onClick={share}>
              {copied === "copied" ? <Link2 aria-hidden /> : <Share2 aria-hidden />}
              {copied === "copied" ? "Link copied" : "Share"}
            </Button>
            <Button asChild variant="outline" className="h-11">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle aria-hidden />
                WhatsApp
              </a>
            </Button>
          </>
        )}
      </div>
      <p role="status" className="text-sm text-destructive">
        {copied === "failed" && "Couldn't copy the link. Copy it from the address bar instead."}
      </p>
    </div>
  );
}
