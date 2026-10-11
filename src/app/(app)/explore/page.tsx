import type { Metadata } from "next";
import { ANON, dbAs } from "@/lib/db";
import { filtersToParams, parseFilters, SERVER_KEYS } from "@/lib/explore/filters";
import { filterOptions, listAreas, searchPlaces } from "@/lib/explore/repo";
import { ExploreApp } from "./explore-app";

export const metadata: Metadata = { title: "Explore · BrewPick Lahore" };

export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const filters = parseFilters(await searchParams);
  const serverParams = filtersToParams(filters, SERVER_KEYS);
  const [places, areas, options] = await dbAs(ANON, (tx) =>
    Promise.all([searchPlaces(tx, parseFilters(serverParams)), listAreas(tx), filterOptions(tx)]),
  );
  return <ExploreApp initialKey={serverParams.toString()} initialPlaces={places} areas={areas} options={options} />;
}
