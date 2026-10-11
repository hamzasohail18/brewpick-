"use client";

import { useCards } from "@/lib/deals/cards";
import { effectivePrice, type Cup, type DealRule } from "@/lib/deals/engine";
import { formatPkr } from "@/lib/explore/format";
import { useNow } from "@/lib/explore/origin";
import { cn } from "@/lib/utils";

/** Effective price for one cup with the user's saved cards, recalculated the moment a card is toggled. */
export function useEffective(cup: Cup | null, deals: readonly DealRule[]) {
  const cards = useCards();
  const now = useNow();
  if (!cup || !now) return null; // server render / no cup: show the menu price
  return effectivePrice(cup, deals, cards, now);
}

/**
 * Price cell: "Rs 672  ̶R̶s̶ ̶8̶4̶0̶ · 20% off with Bank Alfalah" when a deal applies, otherwise the menu
 * price. `withNote` adds the deal title under it.
 */
export function PriceAfterDeals({
  cup,
  deals,
  withNote = true,
  className,
}: {
  cup: Cup;
  deals: readonly DealRule[];
  withNote?: boolean;
  className?: string;
}) {
  const eff = useEffective(cup, deals);
  if (!eff || eff.discountPkr === 0) {
    return <span className={cn("font-semibold tabular-nums", className)}>{formatPkr(cup.pricePkr)}</span>;
  }
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className="tabular-nums">
        <span className="font-semibold text-success">{formatPkr(eff.effectivePricePkr)}</span>{" "}
        <s className="text-xs font-normal text-muted-foreground">
          <span className="sr-only">instead of </span>
          {formatPkr(cup.pricePkr)}
        </s>
      </span>
      {withNote && <span className="text-[11px] leading-tight text-success">{eff.deal!.title}</span>}
    </span>
  );
}
