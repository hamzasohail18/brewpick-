import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getActor } from "@/lib/auth/session";
import { ANON, dbAs } from "@/lib/db";
import { getPlaceDetail } from "@/lib/explore/repo";
import { myClaim } from "@/lib/community/actions";
import { formatLongDate } from "@/lib/explore/format";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Claim this place · BrewPick Lahore" };

export default async function ClaimPage({ params }: PageProps<"/places/[slug]/claim">) {
  const { slug } = await params;
  const place = await dbAs(ANON, (tx) => getPlaceDetail(tx, slug));
  if (!place) notFound();
  const actor = await getActor();
  const claim = actor.kind === "user" ? await dbAs(actor, (tx) => myClaim(tx, actor.userId, place.id)) : null;
  const title = place.branchName ? `${place.name}, ${place.branchName}` : place.name;

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pt-3 pb-8">
      <Link href={`/places/${slug}`} className="-ms-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {title}
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Run {place.name}?</h1>
        <p className="text-sm text-muted-foreground">
          Claim this free listing to confirm your menu, update prices and add deals yourself. Your updates show as Verified.
        </p>
      </div>
      {actor.kind !== "user" ? (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm">Sign in first, so the listing is tied to your account.</p>
          <Button asChild className="h-11">
            <Link href={`/login?next=${encodeURIComponent(`/places/${slug}/claim`)}`}>Sign in</Link>
          </Button>
        </div>
      ) : claim?.status === "approved" ? (
        <div className="space-y-3 rounded-xl border border-success/40 bg-success/10 p-4">
          <p className="text-sm font-medium">You manage this listing.</p>
          <Button asChild className="h-11">
            <Link href="/owner">Open the owner portal</Link>
          </Button>
        </div>
      ) : claim?.status === "pending" ? (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Your claim from {formatLongDate(claim.created_at)} is being checked. We&apos;ll verify it the way you chose, usually within a few days.
        </p>
      ) : (
        <>
          {claim?.status === "rejected" && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Your last claim wasn&apos;t approved{claim.decision_note ? `: ${claim.decision_note}` : "."} You can try again.
            </p>
          )}
          {place.isClaimed ? (
            <p className="rounded-xl border p-4 text-sm">
              This listing is already managed by its owner. If that&apos;s wrong,{" "}
              <Link href={`/places/${slug}/report`} className="underline underline-offset-2">
                report it
              </Link>
              .
            </p>
          ) : (
            <ClaimForm placeId={place.id} listedPhone={place.phone} />
          )}
        </>
      )}
    </main>
  );
}
