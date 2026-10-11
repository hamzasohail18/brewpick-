// Cafe website collector (source kind cafe_website, one source per place): fetches the menu page at the
// source's base_url, parses JSON-LD or HTML, and stages prices (and hours, if the page states them).

import { SERVICE, withActor } from "@/lib/db/core";
import { stageRecords } from "@/lib/pipeline/stage";
import type { CollectorContext, CollectorResult } from "../lib/runner";
import { menuItemsToRecords } from "../lib/menu";
import { livePlaceRecord } from "../lib/place-merge";
import { parseMenuPage } from "./parse";

export async function collectWebsiteMenu(ctx: CollectorContext): Promise<CollectorResult> {
  const placeId = ctx.source.place_id;
  if (!placeId) throw new Error("A cafe website source must be linked to its place (set place_id on the source).");

  const page = await ctx.fetch(ctx.policy.baseUrl);
  if (page.status !== 200) throw new Error(`The menu page returned ${page.status}.`);
  if (page.contentType && !/html/i.test(page.contentType)) {
    throw new Error(`The menu page is ${page.contentType}, not HTML. Use a cafe_menu_file source for PDFs and images.`);
  }
  const snapshot = await ctx.snapshots.save(ctx.runId, "page.html", page.body);
  const menu = parseMenuPage(page.body);
  ctx.log(`${menu.method}: ${menu.items.length} items${menu.hours ? ", hours" : ""}; ${menu.warnings.length} warnings`);

  const capturedAt = new Date().toISOString();
  const provenance = { source_url: page.url, proof_image_url: null, confidence: ctx.source.default_confidence, captured_at: capturedAt };

  const summary = await withActor(ctx.db, SERVICE, async (tx) => {
    const drinkTypes = await tx.query<{ slug: string; aliases: string[] }>("select slug, aliases from drink_types");
    const records = menuItemsToRecords(menu.items, {
      placeId,
      drinkTypes,
      channel: "dine_in",
      sourceUrl: page.url,
      confidence: ctx.source.default_confidence,
      capturedAt,
    });
    if (menu.hours) {
      const place = await livePlaceRecord(tx, placeId, provenance);
      if (place) records.push({ ...place, hours: menu.hours });
    }
    return stageRecords(tx, {
      sourceId: ctx.source.id,
      runId: ctx.runId,
      records,
      evidenceUrl: page.url,
      extraFlags: menu.method === "html" ? ["html_layout"] : [],
      extraMessages: menu.warnings,
    });
  });
  ctx.log(`staged ${summary.staged}, re-confirmed ${summary.reconfirmed}, rejected ${summary.rejected}`);

  // Finding nothing is a failure worth looking at (the page moved or changed layout), not a quiet success.
  if (menu.items.length === 0 && !menu.hours) throw new Error(menu.warnings.at(-1) ?? "No menu items found.");
  return {
    found: menu.items.reduce((n, i) => n + i.prices.length, 0),
    staged: summary.staged,
    partial: summary.rejected > 0 || menu.warnings.length > 0,
    rawSnapshotUrl: snapshot,
  };
}
