import Link from "next/link";
import { getT } from "@/lib/i18n";

// Placeholder until the Home / "Pick for me" screen lands (build step 9).
export default function Home() {
  const t = getT();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
      <p className="text-muted-foreground">{t("app.tagline")}</p>
      <p className="text-sm text-muted-foreground">
        The app screens are on their way. Admins can manage data sources in the{" "}
        <Link href="/admin/sources" className="underline underline-offset-4">
          admin area
        </Link>
        .
      </p>
    </main>
  );
}
