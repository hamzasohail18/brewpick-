import Link from "next/link";
import { connection } from "next/server";
import { attributions } from "@/lib/admin/sources-repo";
import { getT } from "@/lib/i18n";

/** Disclaimer + attribution block generated from sources with attribution_required (Section 8.3). */
export async function SiteFooter() {
  await connection(); // render per request: the registry changes at runtime
  const t = getT();
  let credits: Awaited<ReturnType<typeof attributions>> = [];
  try {
    credits = await attributions();
  } catch (e) {
    console.error("Attribution footer: could not read sources", e); // never take the page down for the footer
  }
  return (
    <footer className="border-t px-4 py-6 text-xs text-muted-foreground">
      <div className="mx-auto max-w-6xl space-y-2">
        <p>{t("footer.disclaimer")}</p>
        {credits.length > 0 && (
          <p>
            <span className="font-medium">{t("footer.dataSources")}:</span> {credits.map((c) => c.attribution_text).join(" · ")}
          </p>
        )}
        <p>
          <Link href="/about" className="underline underline-offset-4">
            {t("footer.about")}
          </Link>
        </p>
      </div>
    </footer>
  );
}
