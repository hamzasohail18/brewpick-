import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "Compare · BrewPick Lahore" };

// Placeholder until this screen is built (see the build order in README).
export default function ComparePage() {
  const t = getT();
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 py-10">
      <h1 className="text-2xl font-semibold">{t("nav.compare")}</h1>
      <p className="text-muted-foreground">Pick 2 to 4 drinks or places and compare price, calories, caffeine and distance side by side.</p>
      <p className="text-sm font-medium">{t("comingSoon")}.</p>
      <Link href="/explore" className="inline-flex min-h-11 items-center underline underline-offset-4">
        Explore places instead
      </Link>
    </main>
  );
}
