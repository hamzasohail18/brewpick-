import type { Metadata } from "next";
import { ANON, dbAs } from "@/lib/db";
import { loadDeals } from "@/lib/deals/repo";
import { DealsApp } from "./deals-app";

export const metadata: Metadata = {
  title: "Deals · BrewPick Lahore",
  description: "Live coffee deals in Lahore: bank cards, wallets, delivery apps and happy hours, with terms and sources.",
};

export default async function DealsPage() {
  const deals = await dbAs(ANON, (tx) => loadDeals(tx));
  return <DealsApp deals={deals} />;
}
