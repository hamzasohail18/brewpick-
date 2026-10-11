import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, ExternalLink, PencilLine, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SampleBadge } from "@/components/app/badges";
import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { ownedPlaces } from "@/lib/community/actions";
import { checkedAgo } from "@/lib/explore/format";
import { ConfirmMenuButton } from "./confirm-menu";

export const metadata: Metadata = { title: "Owner portal · BrewPick Lahore" };

export default async function OwnerPage() {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/login?next=/owner");
  const places = await dbAs(actor, (tx) => ownedPlaces(tx, actor.userId));

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Owner portal</h1>
        <p className="text-sm text-muted-foreground">
          Keep your listing right. Confirming your menu marks every price Verified straight away. Changes, new drinks and deals are checked
          by a reviewer against your photo, then show as Verified.
        </p>
      </div>
      {places.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed p-5 text-sm">
          <p>You don&apos;t manage any places yet.</p>
          <p className="text-muted-foreground">
            Open your cafe on <Link href="/explore" className="underline underline-offset-2">Explore</Link> and tap &ldquo;Claim this free listing&rdquo;.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {places.map((p) => (
            <li key={p.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    {p.name}
                    {p.branch_name && <span className="font-normal text-muted-foreground"> · {p.branch_name}</span>}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {p.area_name ? `${p.area_name} · ` : ""}
                    {p.prices} prices listed
                    {p.oldest_check && (
                      <>
                        {" · "}
                        <Clock aria-hidden className="inline size-3.5" /> oldest {checkedAgo(p.oldest_check)}
                      </>
                    )}
                  </p>
                </div>
                {p.is_sample && <SampleBadge />}
              </div>
              {p.prices > 0 && <ConfirmMenuButton placeId={p.id} />}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" className="h-11">
                  <Link href={`/places/${p.slug}/suggest`}>
                    <PencilLine aria-hidden /> Change a price or add a drink
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11">
                  <Link href={`/places/${p.slug}/suggest?type=new_deal`}>
                    <Tag aria-hidden /> Add a deal
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11">
                  <Link href={`/places/${p.slug}/suggest?type=hours_correction`}>
                    <Clock aria-hidden /> Update hours
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="h-11">
                  <Link href={`/places/${p.slug}`}>
                    <ExternalLink aria-hidden /> View listing
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
