"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CreditCard } from "lucide-react";
import { Chip } from "@/components/app/chip";
import { cn } from "@/lib/utils";
import { useCards } from "@/lib/deals/cards";
import { preloadOnFirstInteraction, useEverOpened } from "./lazy";

export { usePaymentMethods } from "./payment-methods";

// The sheet (Radix dialog + the payment-method list) loads on first open, not with every page.
const loadCardsSheetPanel = () => import("./cards-sheet-panel");
const CardsSheetPanel = dynamic(() => loadCardsSheetPanel().then((m) => m.CardsSheet), { ssr: false });
preloadOnFirstInteraction(loadCardsSheetPanel);

export function CardsSheet(props: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return useEverOpened(props.open) ? <CardsSheetPanel {...props} /> : null;
}

/** "My cards (2)" button + sheet, for any screen that shows prices after deals. */
export function CardsButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const cards = useCards();
  return (
    <>
      <Chip pressed={cards.length > 0} onClick={() => setOpen(true)} className={cn(className)}>
        <CreditCard aria-hidden className="size-4" />
        {compact ? "Cards" : "My cards"}
        {cards.length > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{cards.length}</span>}
      </Chip>
      <CardsSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
