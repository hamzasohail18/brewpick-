import type { Metadata } from "next";
import { connection } from "next/server";
import { attributions } from "@/lib/admin/sources-repo";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "About · BrewPick Lahore" };

export default async function AboutPage() {
  await connection();
  const t = getT();
  const credits = await attributions();
  return (
    <main id="main" className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("about.title")}</h1>
        <p>{t("about.intro")}</p>
      </div>
      <section aria-labelledby="confidence" className="space-y-2">
        <h2 id="confidence" className="text-lg font-semibold">
          {t("about.confidence.title")}
        </h2>
        <ul className="list-disc space-y-1 ps-5">
          <li>{t("about.confidence.verified")}</li>
          <li>{t("about.confidence.community")}</li>
          <li>{t("about.confidence.estimated")}</li>
        </ul>
        <p className="text-sm text-muted-foreground">{t("about.confidence.decay")}</p>
      </section>
      <section aria-labelledby="attributions" className="space-y-2">
        <h2 id="attributions" className="text-lg font-semibold">
          {t("about.attributions")}
        </h2>
        <ul className="space-y-2">
          {credits.map((c) => (
            <li key={c.name} className="rounded-md border bg-card px-3 py-2">
              <div className="font-medium">{c.attribution_text}</div>
              <div className="text-sm text-muted-foreground">
                {c.name}
                {c.license && ` · ${c.license}`}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm">{t("about.corrections")}</p>
    </main>
  );
}
