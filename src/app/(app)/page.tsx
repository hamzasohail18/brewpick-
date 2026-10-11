import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n";

// Placeholder until the Home / "Pick for me" screen lands (build step 9).
export default function Home() {
  const t = getT();
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
      <p className="text-muted-foreground">{t("app.tagline")}</p>
      <Button asChild className="h-12 text-base">
        <Link href="/explore">
          <Compass aria-hidden />
          Explore coffee places
        </Link>
      </Button>
      <p className="text-sm text-muted-foreground">&ldquo;Pick for me&rdquo; is coming soon.</p>
    </main>
  );
}
