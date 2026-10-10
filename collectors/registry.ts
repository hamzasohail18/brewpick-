// Which collector runs for which source slug. A source with no entry can only be filled by hand.

import type { CollectorContext, CollectorResult } from "./lib/runner";
import { collectOsmPlaces } from "./osm";

export const COLLECTORS: Record<string, (ctx: CollectorContext) => Promise<CollectorResult>> = {
  "osm-overpass-lahore": collectOsmPlaces,
};

export const hasCollector = (slug: string) => slug in COLLECTORS;
