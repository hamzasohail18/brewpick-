import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, AtSign, BadgeCheck, Camera, Clock, ExternalLink, Flag, Globe, Navigation, PencilLine, Phone, Star, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, SampleBadge } from "@/components/app/badges";
import { CompareSizeButtons } from "@/components/app/compare-buttons";
import { ANON, dbAs } from "@/lib/db";
import { getT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CHANNEL_LABELS,
  checkedAgo,
  formatPkr,
} from "@/lib/explore/format";
import { PLACE_TYPE_LABELS, ROAST_LABELS } from "@/lib/explore/filters";
import { lahoreClock, weeklyHours } from "@/lib/explore/hours";
import { getPlaceDetail, type MenuItemDetail, type PriceLine } from "@/lib/explore/repo";
import { safeHttp, safeImage } from "@/lib/explore/links";
import { toRule } from "@/lib/deals/repo";
import type { DealRule } from "@/lib/deals/engine";
import { DealCard } from "@/components/app/deal-card";
import { FavoriteButton, RecordView } from "@/components/app/favorite-button";
import { CardsButton } from "@/components/app/cards-sheet";
import { PriceAfterDeals } from "@/components/app/price-after-deals";
import { LiveStatus, MiniMap } from "./live-status";

const load = cache((slug: string) => dbAs(ANON, (tx) => getPlaceDetail(tx, slug)));

export async function generateMetadata({ params }: PageProps<"/places/[slug]">): Promise<Metadata> {
  const place = await load((await params).slug);
  if (!place) return { title: "Place not found · BrewPick Lahore" };
  const name = place.branchName ? `${place.name}, ${place.branchName}` : place.name;
  return {
    title: `${name} · BrewPick Lahore`,
    description: `Coffee prices, calories and deals at ${name}${place.areaName ? `, ${place.areaName}` : ""}, Lahore.`,
  };
}

export default async function PlacePage({ params }: PageProps<"/places/[slug]">) {
  const place = await load((await params).slug);
  if (!place) notFound();
  const t = getT();
  const today = lahoreClock(new Date()).dow;
  const amenities = [
    place.halal && "Halal certified",
    place.wifi && "Wi-Fi",
    place.family && "Family seating",
    place.driveThru && "Drive-thru",
  ].filter(Boolean) as string[];
  const houseBeans = place.beans.filter((b) => !b.menuItemId);
  const rules = place.deals.map(toRule);
  const favEntry = {
    placeId: place.id,
    slug: place.slug,
    name: place.name,
    branchName: place.branchName,
    areaName: place.areaName,
    isSample: place.isSample,
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 pt-3 pb-8">
      <Link href="/explore" className="-ms-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {t("nav.explore")}
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-semibold">
              {place.name}
              {place.branchName && <span className="block text-lg font-normal text-muted-foreground">{place.branchName}</span>}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{PLACE_TYPE_LABELS[place.type as keyof typeof PLACE_TYPE_LABELS] ?? place.type}</span>
              {place.areaName && <span>· {place.areaName}</span>}
              {place.rating !== null && (
                <span className="inline-flex items-center gap-0.5">
                  · <Star aria-hidden className="size-3.5 fill-current text-warning" />
                  <span className="sr-only">Rating</span>
                  {place.rating.toFixed(1)} <span className="opacity-80">({place.ratingCount} ratings)</span>
                </span>
              )}
            </p>
          </div>
          {place.isSample && <SampleBadge />}
        </div>
        <LiveStatus hours={place.hours} lat={place.lat} lng={place.lng} />
        {place.isSample && (
          <p className="rounded-lg border border-dashed border-warning bg-warning/10 p-3 text-sm">
            This is a <strong>fictional sample place</strong> used while the app is being built. Its name, prices, calories and deals are made up.
          </p>
        )}
        <RecordView place={favEntry} />
        <div className="flex flex-wrap gap-2">
          <FavoriteButton place={favEntry} />
          <Button asChild className="h-11">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`} target="_blank" rel="noopener noreferrer">
              <Navigation aria-hidden />
              {t("place.directions")}
            </a>
          </Button>
          {place.phone && (
            <Button asChild variant="outline" className="h-11">
              <a href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>
                <Phone aria-hidden />
                Call
              </a>
            </Button>
          )}
          {safeHttp(place.websiteUrl) && (
            <Button asChild variant="outline" className="h-11">
              <a href={safeHttp(place.websiteUrl)!} target="_blank" rel="noopener noreferrer">
                <Globe aria-hidden />
                Website
              </a>
            </Button>
          )}
          {place.instagramHandle && (
            <Button asChild variant="outline" className="h-11">
              <a href={`https://www.instagram.com/${encodeURIComponent(place.instagramHandle.replace(/^@/, ""))}/`} target="_blank" rel="noopener noreferrer">
                <AtSign aria-hidden />
                Instagram
              </a>
            </Button>
          )}
        </div>
        {amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Facilities">
            {amenities.map((a) => (
              <li key={a} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                {a}
              </li>
            ))}
          </ul>
        )}
      </header>

      {place.deals.length > 0 && (
        <section aria-labelledby="deals" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="deals" className="text-lg font-semibold">
              {t("place.deals")} <span className="text-sm font-normal text-muted-foreground">({place.deals.length})</span>
            </h2>
            <CardsButton />
          </div>
          <p className="text-sm text-muted-foreground">Menu prices below show the best deal you can use right now.</p>
          <ul className="space-y-3">
            {place.deals.map((d) => (
              <li key={d.id}>
                <DealCard deal={d} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="menu" className="space-y-3">
        <h2 id="menu" className="text-lg font-semibold">
          {t("place.menu")}
        </h2>
        {place.menu.length === 0 ? (
          <div className="rounded-xl border border-dashed p-5 text-sm">
            <p className="font-medium">No prices collected yet.</p>
            <p className="mt-1 text-muted-foreground">
              We only show prices we have a source for. Volunteers add menus with in-store photos, and owners can confirm their own.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Prices in Pakistani rupees. Every price shows how sure we are and when it was last checked.</p>
            <ul className="space-y-3">
              {place.menu.map((item) => (
                <li key={item.id}>
                  <MenuItemCard
                    item={item}
                    placeLabel={place.branchName ? `${place.name} ${place.branchName}` : place.name}
                    placeId={place.id}
                    brandId={place.brandId}
                    deals={rules}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {houseBeans.length > 0 && (
        <section aria-labelledby="beans" className="space-y-3">
          <h2 id="beans" className="text-lg font-semibold">
            {t("place.beans")}
          </h2>
          {houseBeans.map((b, i) => (
            <div key={i} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {b.kind && (
                  <>
                    <dt className="text-muted-foreground">Type</dt>
                    <dd>{b.kind === "single_origin" ? "Single origin" : "Blend"}</dd>
                  </>
                )}
                {b.originCountry && (
                  <>
                    <dt className="text-muted-foreground">Origin</dt>
                    <dd>{[b.originCountry, b.originRegion].filter(Boolean).join(", ")}</dd>
                  </>
                )}
                {b.roast && (
                  <>
                    <dt className="text-muted-foreground">Roast</dt>
                    <dd>{ROAST_LABELS[b.roast as keyof typeof ROAST_LABELS] ?? b.roast}</dd>
                  </>
                )}
                {(b.arabicaPct !== null || b.robustaPct !== null) && (
                  <>
                    <dt className="text-muted-foreground">Beans</dt>
                    <dd>
                      {[b.arabicaPct !== null && `${b.arabicaPct}% Arabica`, b.robustaPct ? `${b.robustaPct}% Robusta` : null].filter(Boolean).join(" · ")}
                    </dd>
                  </>
                )}
                {b.roaster && (
                  <>
                    <dt className="text-muted-foreground">Roaster</dt>
                    <dd>{b.roaster}</dd>
                  </>
                )}
                {b.tastingNotes && (
                  <>
                    <dt className="text-muted-foreground">Tastes of</dt>
                    <dd>{b.tastingNotes}</dd>
                  </>
                )}
              </dl>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ConfidenceBadge level={b.confidence} checkedAt={b.verifiedAt} />
                {b.sourceName && <span>Source: {b.sourceName}</span>}
              </p>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="hours" className="space-y-3">
        <h2 id="hours" className="flex items-center gap-2 text-lg font-semibold">
          <Clock aria-hidden className="size-4" />
          {t("place.hours")}
        </h2>
        {place.hours.length === 0 ? (
          <p className="text-sm text-muted-foreground">Opening hours aren&apos;t known yet.</p>
        ) : (
          <table className="w-full max-w-sm text-sm">
            <caption className="sr-only">Opening hours, Lahore time</caption>
            <tbody>
              {weeklyHours(place.hours).map((d) => (
                <tr key={d.day} className={cn(d.day === today && "font-semibold")}>
                  <th scope="row" className="py-1 pe-4 text-start font-[inherit]">
                    {d.name}
                    {d.day === today && <span className="sr-only"> (today)</span>}
                  </th>
                  <td className="py-1">{d.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="where" className="space-y-3">
        <h2 id="where" className="text-lg font-semibold">
          Location
        </h2>
        {place.address && <p className="text-sm">{place.address}</p>}
        <MiniMap lat={place.lat} lng={place.lng} name={place.name} />
      </section>

      <section aria-labelledby="help" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 id="help" className="font-semibold">
          Help keep this right
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-11">
            <Link href={`/places/${place.slug}/suggest`}>
              <PencilLine aria-hidden />
              Suggest a correction
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link href={`/places/${place.slug}/suggest?type=new_deal`}>
              <Tag aria-hidden />
              Add a deal
            </Link>
          </Button>
          <Button asChild variant="ghost" className="h-11">
            <Link href={`/places/${place.slug}/report`}>
              <Flag aria-hidden />
              Report a problem
            </Link>
          </Button>
        </div>
        {place.isClaimed ? (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <BadgeCheck aria-hidden className="size-4" /> Managed by the verified owner
          </p>
        ) : (
          <p className="text-sm">
            Run this cafe?{" "}
            <Link href={`/places/${place.slug}/claim`} className="font-medium underline underline-offset-2">
              Claim this free listing
            </Link>
          </p>
        )}
      </section>

      <footer className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
        <p className="flex flex-wrap items-center gap-2">
          <span>Place details:</span>
          <ConfidenceBadge level={place.confidence} checkedAt={place.verifiedAt} />
          {place.sourceName && <span>Source: {place.sourceName}</span>}
        </p>
        <p>Details can change. Check with the cafe before you go.</p>
      </footer>
    </main>
  );
}

// ---------- menu ----------

function MenuItemCard({
  item,
  placeLabel,
  placeId,
  brandId,
  deals,
}: {
  item: MenuItemDetail;
  placeLabel: string;
  placeId: string;
  brandId: string | null;
  deals: DealRule[];
}) {
  const channels = new Set(item.sizes.flatMap((s) => s.prices.map((p) => p.channel)));
  const nutrition = item.sizes.map((s) => s.nutrition).filter((n) => n !== null);
  const assumptions = item.sizes.filter((s) => s.nutrition?.assumptions);
  const nutritionLevel = nutrition.find((n) => n.confidence)?.confidence ?? null;
  const allPrices = item.sizes.flatMap((s) => s.prices.map((p) => ({ size: s.label, p })));
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{item.name}</h3>
        <span className="text-xs text-muted-foreground">{item.temperature === "iced" ? "Iced" : item.temperature === "both" ? "Hot or iced" : "Hot"}</span>
      </header>
      {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="sr-only">{item.name}: price and nutrition per size</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="px-1 pb-1 font-medium">Size</th>
              <th scope="col" className="px-1 pb-1 font-medium">Price</th>
              <th scope="col" className="px-1 pb-1 text-end font-medium">Calories</th>
              <th scope="col" className="px-1 pb-1 text-end font-medium">Sugar</th>
              <th scope="col" className="px-1 pb-1 text-end font-medium">Caffeine</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {item.sizes.map((s) => {
              const [main, ...others] = s.prices;
              return (
                <tr key={s.id} className="align-top">
                  <th scope="row" className="px-1 py-1.5 text-start font-normal">
                    {s.label}
                    {s.volumeMl && (
                      <span className="block text-xs text-muted-foreground" title={s.volumeIsAssumed ? "Volume not stated; standard size assumed" : undefined}>
                        {s.volumeIsAssumed ? "≈" : ""}
                        {s.volumeMl} ml
                      </span>
                    )}
                  </th>
                  <td className="px-1 py-1.5">
                    <PriceAfterDeals
                      cup={{ pricePkr: main.pricePkr, menuItemId: item.id, placeId, brandId, channel: main.channel }}
                      deals={deals}
                    />
                    {channels.size > 1 && <span className="ms-1 text-xs text-muted-foreground">{CHANNEL_LABELS[main.channel]}</span>}
                    <span className="block text-xs text-muted-foreground">{taxLabel(main.taxInclusive)}</span>
                    {others.map((o) => (
                      <span key={o.channel} className="block text-xs text-muted-foreground tabular-nums">
                        {CHANNEL_LABELS[o.channel]} {formatPkr(o.pricePkr)}
                      </span>
                    ))}
                  </td>
                  <td className="px-1 py-1.5 text-end tabular-nums">{s.nutrition?.kcal ?? "—"}</td>
                  <td className="px-1 py-1.5 text-end tabular-nums">{s.nutrition?.sugarG != null ? `${s.nutrition.sugarG} g` : "—"}</td>
                  <td className="px-1 py-1.5 text-end tabular-nums">{s.nutrition?.caffeineMg != null ? `${s.nutrition.caffeineMg} mg` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5 text-xs">
        {provenance(allPrices).map((g) => (
          <p key={g.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span className="font-medium text-foreground">Price{g.sizes ? ` (${g.sizes})` : ""}:</span>
            <ConfidenceBadge level={g.p.confidence} checkedAt={g.p.verifiedAt} />
            {g.p.sourceName && <span>Source: {g.p.sourceName}</span>}
            {safeHttp(g.p.sourceUrl) && (
              <a href={safeHttp(g.p.sourceUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-0.5 underline underline-offset-2">
                link <ExternalLink aria-hidden className="size-3" />
              </a>
            )}
            {safeImage(g.p.proofImageUrl) && (
              <a href={safeImage(g.p.proofImageUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-0.5 underline underline-offset-2">
                <Camera aria-hidden className="size-3" /> menu photo
              </a>
            )}
          </p>
        ))}
        {nutritionLevel && (
          <div className="text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">Nutrition:</span>
              <ConfidenceBadge level={nutritionLevel} />
              {nutrition[0]?.sourceName && <span>Source: {nutrition[0].sourceName}</span>}
            </p>
            {assumptions.length > 0 && (
              <details className="mt-1">
                <summary className="inline-flex min-h-8 cursor-pointer items-center underline underline-offset-2">How this was estimated</summary>
                <ul className="mt-1 list-disc space-y-0.5 ps-5">
                  {assumptions.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.label}:</span> {s.nutrition!.assumptions}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {item.milkOptions.length > 0 && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Milk options: </span>
            {item.milkOptions
              .map(
                (o) =>
                  `${o.name} ${o.extraPricePkr ? `+${formatPkr(o.extraPricePkr)}` : "no extra charge"}${
                    o.extraKcal ? ` (${o.extraKcal > 0 ? "+" : "−"}${Math.abs(o.extraKcal)} kcal)` : ""
                  }`,
              )
              .join(" · ")}
            {item.milkOptions.some((o) => o.extraKcal) && <span> · calorie change for the first size, estimated</span>}
          </p>
        )}
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Allergens: </span>
          {item.allergens.length > 0
            ? `${item.allergens.map((a) => a.name).join(", ")}${item.allergens.some((a) => a.confidence === "estimated") ? " (estimated from the recipe)" : ""}`
            : item.ingredients.length > 0
              ? "none of dairy, nuts, gluten or soy in the standard recipe"
              : "not known yet"}
          {item.milkOptions.some((o) => o.slug === "almond") && " · almond milk contains nuts"}
        </p>
        {item.ingredients.length > 0 && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Made with: </span>
            {item.ingredients.join(", ")}
          </p>
        )}
      </div>
      <CompareSizeButtons sizes={item.sizes.map((s) => ({ id: s.id, label: s.label }))} drinkName={item.name} placeName={placeLabel} />
    </article>
  );
}

/** Group prices that share confidence, source and check date so the card shows each provenance once. */
function provenance(prices: { size: string; p: PriceLine }[]) {
  const groups = new Map<string, { key: string; p: PriceLine; sizes: string[] }>();
  for (const { size, p } of prices) {
    const key = [p.confidence, p.sourceName, checkedAgo(p.verifiedAt), p.sourceUrl, p.proofImageUrl].join("|");
    const g = groups.get(key) ?? { key, p, sizes: [] };
    if (!g.sizes.includes(size)) g.sizes.push(size);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  return list.map((g) => ({ ...g, sizes: list.length > 1 ? g.sizes.join(", ") : null }));
}

const taxLabel = (v: boolean | null) => (v === true ? "incl. tax" : v === false ? "+ tax" : "tax not stated");

