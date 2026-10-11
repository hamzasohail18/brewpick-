import type { Metadata, Viewport } from "next";
import { ANON, dbAs } from "@/lib/db";
import { requireCapturer } from "@/lib/auth/session";
import { DEFAULT_MAX_DISTANCE_M } from "@/lib/capture/geo";
import { CaptureApp, type CapturePlace } from "./capture-app";

export const metadata: Metadata = { title: "Menu Capture · BrewPick" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function CapturePage() {
  const actor = await requireCapturer();
  const [places, drinkNames] = await Promise.all([
    dbAs(ANON, (tx) =>
      tx.query<CapturePlace>(
        `select p.id, p.name, p.branch_name, a.name as area, p.lat::float8 as lat, p.lng::float8 as lng, p.is_sample
           from places p left join areas a on a.id = p.area_id
          where p.status = 'published' order by p.name, p.branch_name`,
      ),
    ),
    dbAs(ANON, (tx) => tx.query<{ name: string }>("select name from drink_types order by name")),
  ]);
  return (
    <CaptureApp
      places={places}
      drinkNames={drinkNames.map((d) => d.name)}
      maxDistanceM={Number(process.env.CAPTURE_MAX_DISTANCE_M) || DEFAULT_MAX_DISTANCE_M}
      userLabel={actor.email ?? "Volunteer"}
    />
  );
}
