import Link from "next/link";
import { getT } from "@/lib/i18n";

export default function PlaceNotFound() {
  const t = getT();
  return (
    <main id="main" className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t("place.notFound")}</h1>
      <p className="text-sm text-muted-foreground">It may have closed, or the link is out of date.</p>
      <Link href="/explore" className="inline-flex min-h-11 items-center underline underline-offset-4">
        Back to {t("nav.explore")}
      </Link>
    </main>
  );
}
