"use client";

import Link from "next/link";
import { Camera, Check, Clock, CreditCard, ExternalLink, MapPin, Tag } from "lucide-react";
import { ConfidenceBadge, SampleBadge } from "@/components/app/badges";
import { cn } from "@/lib/utils";
import { useCards } from "@/lib/deals/cards";
import { dealStatus, lahoreNow } from "@/lib/deals/engine";
import type { DealView } from "@/lib/deals/repo";
import { formatDistance } from "@/lib/capture/geo";
import {
  conditionLabel,
  DEAL_TYPE_LABELS,
  dealEndsSoon,
  dealSchedule,
  discountLabel,
  endsInLabel,
  formatDealDate,
} from "@/lib/explore/format";
import { formatClock } from "@/lib/explore/hours";
import { useNow } from "@/lib/explore/origin";
import { safeHttp, safeImage } from "@/lib/explore/links";

/** One deal with terms, schedule, who can use it, whether it's on now, and its source (Section 3C). */
export function DealCard({ deal: d, showPlaces = false, nearestM = null }: { deal: DealView; showPlaces?: boolean; nearestM?: number | null }) {
  const cards = useCards();
  const nowDate = useNow();
  const status = nowDate ? dealStatus(d, cards, lahoreNow(nowDate)) : null;
  const endsIn = nowDate ? dealEndsSoon(d.validTo, nowDate) : null;
  const needsCard = d.paymentMethodIds.length > 0;
  const placeName = d.isBrandWide ? d.brandName : d.places[0]?.name;

  return (
    <article className="space-y-2 rounded-xl border border-primary/30 bg-accent/40 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          <Tag aria-hidden className="size-3" />
          {DEAL_TYPE_LABELS[d.dealType] ?? d.dealType}
        </span>
        {endsIn !== null && (
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
            {endsInLabel(d.validTo, nowDate!)}
          </span>
        )}
        {status &&
          (status.onNow ? (
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">On now</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              <Clock aria-hidden className="size-3" />
              {status.today && d.startTime ? `From ${formatClock(d.startTime)}` : "Not today"}
            </span>
          ))}
        {d.isSample && <SampleBadge />}
      </div>

      {showPlaces && placeName && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
          <MapPin aria-hidden className="size-3.5 text-muted-foreground" />
          {d.isBrandWide ? (
            <span className="font-medium">
              {placeName} <span className="font-normal text-muted-foreground">· all {d.places.length} branches</span>
            </span>
          ) : (
            <Link href={`/places/${d.places[0].slug}`} className="font-medium underline-offset-2 hover:underline">
              {placeName}
              {d.places[0].branchName && <span className="font-normal text-muted-foreground"> · {d.places[0].branchName}</span>}
            </Link>
          )}
          {nearestM !== null && <span className="text-muted-foreground">· {formatDistance(nearestM)}{d.isBrandWide ? " to the nearest" : ""}</span>}
        </p>
      )}

      <h3 className="font-semibold">{d.title}</h3>
      <p className="text-sm font-medium">{discountLabel(d)}</p>
      <ul className="space-y-0.5 text-sm text-muted-foreground">
        <li>{dealSchedule(d)}</li>
        <li className={cn("flex items-center gap-1", needsCard && status?.usable && "font-medium text-success")}>
          {needsCard && status?.usable ? <Check aria-hidden className="size-3.5" /> : <CreditCard aria-hidden className="size-3.5" />}
          {!needsCard ? "Open to everyone" : status?.usable ? `You have ${d.paymentMethods.filter((_, i) => cards.includes(d.paymentMethodIds[i])).join(", ")}` : `With ${d.paymentMethods.join(" or ")}`}
        </li>
        {d.items.length > 0 && <li>Only on: {[...new Set(d.items)].join(", ")}</li>}
        {d.conditions.length > 0 && <li>{d.conditions.map(conditionLabel).join(" · ")}</li>}
        {showPlaces && d.isBrandWide && d.places.length > 1 && (
          <li>
            Branches:{" "}
            {d.places.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link href={`/places/${p.slug}`} className="underline underline-offset-2">
                  {p.branchName ?? p.name}
                </Link>
              </span>
            ))}
          </li>
        )}
        {!showPlaces && d.isBrandWide && d.brandName && <li>At all {d.brandName} branches</li>}
        <li>Valid until {formatDealDate(d.validTo)}</li>
      </ul>
      {d.terms && <p className="text-xs text-muted-foreground">Terms: {d.terms}</p>}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ConfidenceBadge level={d.confidence} checkedAt={d.verifiedAt} />
        {d.sourceName && <span>Source: {d.sourceName}</span>}
        {safeHttp(d.sourceUrl) && (
          <a href={safeHttp(d.sourceUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-0.5 underline underline-offset-2">
            offer page <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
        {safeImage(d.proofImageUrl) && (
          <a href={safeImage(d.proofImageUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-0.5 underline underline-offset-2">
            <Camera aria-hidden className="size-3" /> proof
          </a>
        )}
      </p>
    </article>
  );
}
