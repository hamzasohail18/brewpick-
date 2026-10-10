// OSM places collector: Overpass -> PlaceRecords -> review queue. Never writes live tables.

import { SERVICE, withActor } from "@/lib/db/core";
import { stageRecords } from "@/lib/pipeline/stage";
import type { CollectorContext, CollectorResult } from "../lib/runner";
import { buildOverpassQuery, mapOverpass, type Area, type OverpassElement } from "./overpass";

export async function collectOsmPlaces(ctx: CollectorContext): Promise<CollectorResult> {
  const query = buildOverpassQuery();
  const page = await ctx.fetch(ctx.policy.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (page.status !== 200) throw new Error(`Overpass returned ${page.status}: ${page.body.slice(0, 200)}`);

  const snapshot = await ctx.snapshots.save(ctx.runId, "overpass.json", page.body);
  const json = JSON.parse(page.body) as { elements?: OverpassElement[]; remark?: string };
  if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
  const elements = json.elements ?? [];

  const areas = await withActor(ctx.db, SERVICE, (tx) =>
    tx.query<Area>("select id, name, centroid_lat, centroid_lng from areas"),
  );
  const { records, skipped } = mapOverpass(elements, areas, new Date().toISOString());
  ctx.log(`${elements.length} OSM elements -> ${records.length} places (${skipped.length} skipped)`);

  const summary = await withActor(ctx.db, SERVICE, (tx) =>
    stageRecords(tx, { sourceId: ctx.source.id, runId: ctx.runId, records, evidenceUrl: null }),
  );
  ctx.log(`staged ${summary.staged}, re-confirmed ${summary.reconfirmed}, rejected ${summary.rejected}`);

  return {
    found: elements.length,
    staged: summary.staged,
    partial: summary.rejected > 0,
    rawSnapshotUrl: snapshot,
  };
}
