// Which collector runs for which source: a specific source slug first, then the source's kind (one
// collector serves every per-cafe website / menu file / bank page). No match = filled by hand only.

import type { SourceKind } from "@/lib/domain/sources";
import type { CollectorContext, CollectorResult } from "./lib/runner";
import { collectBankOffers } from "./bank-offers";
import { collectGooglePlaces } from "./google-places";
import { collectMenuFile } from "./menu-file";
import { collectOsmPlaces } from "./osm";
import { collectWebsiteMenu } from "./website";

export type Collector = (ctx: CollectorContext) => Promise<CollectorResult>;

export const COLLECTORS_BY_SLUG: Record<string, Collector> = {
  "osm-overpass-lahore": collectOsmPlaces,
  "google-places-api": collectGooglePlaces,
};

export const COLLECTORS_BY_KIND: Partial<Record<SourceKind, Collector>> = {
  cafe_website: collectWebsiteMenu,
  cafe_menu_file: collectMenuFile,
  bank_offer_page: collectBankOffers,
};

export function collectorFor(source: { slug: string; kind: SourceKind }): Collector | null {
  return COLLECTORS_BY_SLUG[source.slug] ?? COLLECTORS_BY_KIND[source.kind] ?? null;
}

export const hasCollector = (source: { slug: string; kind: SourceKind }) => collectorFor(source) !== null;
