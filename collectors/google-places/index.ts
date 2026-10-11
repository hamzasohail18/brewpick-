// Google Places collector (source google-places-api): official Text Search API only, never Maps pages.
// Needs GOOGLE_PLACES_API_KEY (sent as a header, never in the URL). The source's review notes must cover
// Google's caching and attribution terms before the guard lets this run; reviewers see that reminder.

import { SERVICE, withActor } from "@/lib/db/core";
import { stageRecords } from "@/lib/pipeline/stage";
import type { CollectorContext, CollectorResult } from "../lib/runner";
import { fillFromLive } from "../lib/place-merge";
import type { Area } from "../osm/overpass";
import { FIELD_MASK, SEARCHES, mapGooglePlaces, searchBody, type GooglePlace } from "./map";

const MAX_PAGES = 3; // Text Search returns at most 60 results per query

export async function collectGooglePlaces(ctx: CollectorContext): Promise<CollectorResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY isn't set.");

  const byId = new Map<string, GooglePlace>();
  const pages: unknown[] = [];
  for (const query of SEARCHES) {
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await ctx.fetch(`${ctx.policy.baseUrl.replace(/\/$/, "")}/places:searchText`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
        body: JSON.stringify(searchBody(query, token)),
      });
      if (res.status !== 200) throw new Error(`Places API returned ${res.status}: ${res.body.slice(0, 200)}`);
      const json = JSON.parse(res.body) as { places?: GooglePlace[]; nextPageToken?: string };
      pages.push({ query, page, ...json });
      for (const p of json.places ?? []) byId.set(p.id, p);
      token = json.nextPageToken;
      if (!token) break;
    }
  }
  const snapshot = await ctx.snapshots.save(ctx.runId, "places.json", JSON.stringify(pages));

  const summary = await withActor(ctx.db, SERVICE, async (tx) => {
    const areas = await tx.query<Area>("select id, name, centroid_lat, centroid_lng from areas");
    const { records, skipped } = mapGooglePlaces([...byId.values()], areas, new Date().toISOString());
    ctx.log(`${byId.size} Google places -> ${records.length} records (${skipped.length} skipped)`);
    const merged = [];
    for (const r of records) merged.push(await fillFromLive(tx, { ...r, confidence: ctx.source.default_confidence }));
    return stageRecords(tx, {
      sourceId: ctx.source.id,
      runId: ctx.runId,
      records: merged,
      extraMessages: [
        "From the Google Places API. Before approving, check the source's notes on Google's caching limits " +
          `(max ${ctx.policy.maxCacheDays ?? "?"} days) and show "${ctx.source.attribution_text ?? "Google"}" where it's used.`,
      ],
    });
  });
  ctx.log(`staged ${summary.staged}, re-confirmed ${summary.reconfirmed}, rejected ${summary.rejected}`);
  return { found: byId.size, staged: summary.staged, partial: summary.rejected > 0, rawSnapshotUrl: snapshot };
}
