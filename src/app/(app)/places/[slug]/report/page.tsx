import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getActor } from "@/lib/auth/session";
import { ANON, dbAs } from "@/lib/db";
import { getPlaceDetail } from "@/lib/explore/repo";
import { ReportForm } from "./report-form";

export const metadata: Metadata = { title: "Report a problem · BrewPick Lahore" };

export default async function ReportPage({ params, searchParams }: PageProps<"/places/[slug]/report">) {
  const { slug } = await params;
  const sp = await searchParams;
  const place = await dbAs(ANON, (tx) => getPlaceDetail(tx, slug));
  if (!place) notFound();
  const deal = typeof sp.deal === "string" ? place.deals.find((d) => d.id === sp.deal) : undefined;
  const actor = await getActor();
  const here = `/places/${slug}/report${deal ? `?deal=${deal.id}` : ""}`;
  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pt-3 pb-8">
      <Link href={`/places/${slug}`} className="-ms-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {place.name}
      </Link>
      <h1 className="text-2xl font-semibold">Report a problem</h1>
      <p className="text-sm text-muted-foreground">{deal ? `About the deal “${deal.title}”.` : `About ${place.name}${place.branchName ? `, ${place.branchName}` : ""}.`}</p>
      {actor.kind !== "user" ? (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm">Sign in to report a problem, so we can follow up if we need to.</p>
          <Button asChild className="h-11">
            <Link href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link>
          </Button>
        </div>
      ) : (
        <ReportForm placeSlug={slug} target={deal ? { table: "deals", id: deal.id } : { table: "places", id: place.id }} />
      )}
    </main>
  );
}
