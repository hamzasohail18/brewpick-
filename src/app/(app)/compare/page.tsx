import type { Metadata } from "next";
import { headers } from "next/headers";
import { ANON, dbAs } from "@/lib/db";
import { getT } from "@/lib/i18n";
import { compareHref, parseCompare, selectionSize } from "@/lib/compare/params";
import { getComparison, shareText } from "@/lib/compare/repo";
import { filterOptions } from "@/lib/explore/repo";
import { CompareStart } from "./compare-start";
import { CompareView } from "./compare-view";

export const metadata: Metadata = {
  title: "Compare · BrewPick Lahore",
  description: "Compare coffee prices, calories and caffeine across Lahore cafes side by side.",
};

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const t = getT();
  const selection = parseCompare(await searchParams);
  const { drinks } = await dbAs(ANON, (tx) => filterOptions(tx));

  if (selectionSize(selection) === 0) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("nav.compare")}</h1>
        <CompareStart drinks={drinks} />
      </main>
    );
  }

  const result = await dbAs(ANON, (tx) => getComparison(tx, selection));
  const resolved = { ...selection, drink: selection.places.length ? (result.drink?.slug ?? null) : null };
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.compare")}</h1>
        <p className="text-sm text-muted-foreground">
          {result.drink ? `${result.drink.name} at ${result.columns.length} places` : `${result.columns.length} drinks side by side`}
        </p>
      </div>
      <CompareView
        result={result}
        selection={resolved}
        drinks={drinks}
        shareText={shareText(result)}
        shareUrl={`${await origin()}${compareHref(resolved)}`}
      />
    </main>
  );
}

/** Public origin for share links: APP_URL in production, the request's host otherwise. */
async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
