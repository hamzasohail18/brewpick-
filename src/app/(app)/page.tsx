import { ANON, dbAs } from "@/lib/db";
import { loadDeals } from "@/lib/deals/repo";
import { listAreas, searchPlaces } from "@/lib/explore/repo";
import { HomeApp } from "./home-app";

// Home (Section 4): one big "What should I drink?" action, nearby top 3, today's best deals.
export default async function Home() {
  const [places, deals, areas] = await dbAs(ANON, (tx) => Promise.all([searchPlaces(tx, {}), loadDeals(tx), listAreas(tx)]));
  return <HomeApp places={places.filter((p) => p.hasMenu)} deals={deals} areas={areas} />;
}
