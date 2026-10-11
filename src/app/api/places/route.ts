import { NextResponse } from "next/server";
import { ANON, dbAs } from "@/lib/db";
import { filtersToParams, parseFilters, SERVER_KEYS } from "@/lib/explore/filters";
import { searchPlaces } from "@/lib/explore/repo";

// Explore results for the current filters. Public data only (runs as anon, so RLS applies).
// No location in the request: distance and "open now" are worked out on the phone.
export async function GET(req: Request) {
  const all = parseFilters(new URL(req.url).searchParams);
  const filters = parseFilters(filtersToParams(all, SERVER_KEYS)); // ignore on-device keys
  const places = await dbAs(ANON, (tx) => searchPlaces(tx, filters));
  return NextResponse.json(
    { places },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
