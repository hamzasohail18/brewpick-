import type { Metadata } from "next";
import { SavedPlaces } from "./saved-places";

export const metadata: Metadata = { title: "Offline · BrewPick Lahore" };
// Precached by the service worker and shown when a page you haven't opened before can't load.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-28">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">You&rsquo;re offline</h1>
        <p className="text-sm text-muted-foreground">
          This page wasn&rsquo;t saved on this phone yet. Places you&rsquo;ve opened before still work; their prices are from your last
          visit, so confirm with the cafe.
        </p>
      </div>
      <SavedPlaces />
    </main>
  );
}
