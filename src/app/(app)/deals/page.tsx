import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "Deals · BrewPick Lahore" };

// Placeholder until this screen is built (see the build order in README).
export default function DealsPage() {
  const t = getT();
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("nav.deals")}</h1>
      <p className="text-muted-foreground">Today&apos;s bank, app and happy-hour deals, with the price you&apos;d actually pay using your saved cards.</p>
      <p className="text-sm font-medium">{t("comingSoon")}.</p>
      <Link href="/explore" className="inline-flex min-h-11 items-center underline underline-offset-4">
        Explore places instead
      </Link>
    </main>
  );
}
