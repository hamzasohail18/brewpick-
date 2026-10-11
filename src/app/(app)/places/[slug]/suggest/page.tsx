import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getActor } from "@/lib/auth/session";
import { ANON, dbAs } from "@/lib/db";
import { listPaymentMethods } from "@/lib/deals/repo";
import { getPlaceDetail } from "@/lib/explore/repo";
import { formatPkr } from "@/lib/explore/format";
import { SuggestForm } from "./suggest-form";

export const metadata: Metadata = { title: "Suggest a correction · BrewPick Lahore" };

export default async function SuggestPage({ params, searchParams }: PageProps<"/places/[slug]/suggest">) {
  const { slug } = await params;
  const sp = await searchParams;
  const [place, methods] = await dbAs(ANON, (tx) => Promise.all([getPlaceDetail(tx, slug), listPaymentMethods(tx)]));
  if (!place) notFound();
  const actor = await getActor();
  const title = place.branchName ? `${place.name}, ${place.branchName}` : place.name;
  const sizes = place.menu.flatMap((item) =>
    item.sizes.map((s) => ({ id: s.id, label: `${item.name} · ${s.label} (now ${formatPkr(s.prices[0].pricePkr)})` })),
  );
  return (
    <main id="main" className="mx-auto max-w-md space-y-5 px-4 pt-3 pb-8">
      <Link href={`/places/${slug}`} className="-ms-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {title}
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Suggest a correction</h1>
        <p className="text-sm text-muted-foreground">
          A reviewer checks every suggestion against your photo before it goes live.
          {place.isSample && " This is a fictional sample place, so suggestions here are only for trying the feature."}
        </p>
      </div>
      {actor.kind !== "user" ? (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm">Sign in to send corrections, so we can tell you when yours goes live (and to keep spam out).</p>
          <Button asChild className="h-11">
            <Link href={`/login?next=${encodeURIComponent(`/places/${slug}/suggest`)}`}>Sign in</Link>
          </Button>
        </div>
      ) : (
        <SuggestForm
          placeId={place.id}
          placeSlug={slug}
          sizes={sizes}
          hours={place.hours}
          paymentMethods={methods.map((m) => m.name)}
          initialType={typeof sp.type === "string" ? sp.type : undefined}
        />
      )}
    </main>
  );
}
