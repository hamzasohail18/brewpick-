"use client";

// The cards sheet itself, loaded the first time someone opens it (see CardsSheet in cards-sheet.tsx).

import { ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/app/chip";
import { setCards, toggleCard, useCards } from "@/lib/deals/cards";
import type { PaymentMethod } from "@/lib/deals/repo";
import { usePaymentMethods } from "./payment-methods";

const KIND_LABELS: Record<PaymentMethod["kind"], string> = {
  bank_card: "Bank cards",
  wallet: "Wallets",
  delivery_app: "Delivery apps",
  loyalty_program: "Loyalty programmes",
};

/** Pick the banks/apps you have; every price after deals updates as you tap. */
export function CardsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const cards = useCards();
  const methods = usePaymentMethods();
  const groups = (Object.keys(KIND_LABELS) as PaymentMethod["kind"][])
    .map((kind) => ({ kind, items: (methods.data ?? []).filter((m) => m.kind === kind) }))
    .filter((g) => g.items.length);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-h-[88dvh] max-w-2xl gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b">
          <SheetTitle>My cards and apps</SheetTitle>
          <SheetDescription className="flex items-start gap-1.5">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            Just the bank or app name, never card numbers. Saved on this phone only.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto p-4">
          {methods.isPending && <div className="h-40 animate-pulse rounded-lg bg-muted" aria-hidden />}
          {methods.isError && (
            <p role="alert" className="text-sm text-destructive">
              {methods.error.message}
            </p>
          )}
          {groups.map((g) => (
            <fieldset key={g.kind} className="space-y-2">
              <legend className="text-sm font-medium">{KIND_LABELS[g.kind]}</legend>
              <div className="flex flex-wrap gap-2">
                {g.items.map((m) => (
                  <Chip key={m.id} pressed={cards.includes(m.id)} onClick={() => toggleCard(m.id)}>
                    {m.name}
                    {m.tier ? ` ${m.tier}` : ""}
                  </Chip>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <SheetFooter className="flex-row border-t">
          {cards.length > 0 && (
            <Button variant="outline" className="h-11 flex-1" onClick={() => setCards([])}>
              Clear all
            </Button>
          )}
          <Button className="h-11 flex-1" onClick={() => onOpenChange(false)}>
            Done{cards.length ? ` (${cards.length})` : ""}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
