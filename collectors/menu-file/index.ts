// Published menu file collector (source kind cafe_menu_file, one source per place): downloads the PDF or
// image the cafe publishes at base_url, extracts text (PDF text layer or OCR), parses prices and stages
// them. Every record is flagged for review; OCR errors on prices are common (Section 7.2).
// The file itself is kept only as an audit snapshot; public tables get facts, never the file.

import { SERVICE, withActor } from "@/lib/db/core";
import { stageRecords } from "@/lib/pipeline/stage";
import type { CollectorContext, CollectorResult } from "../lib/runner";
import { menuItemsToRecords } from "../lib/menu";
import { extractMenuText, fileKind, type OcrEngine } from "./ocr";
import { parseMenuText } from "./parse-text";

/** Below this mean Tesseract confidence, every record also gets "OCR unsure". */
export const OCR_LOW_CONFIDENCE = 75;

export function collectMenuFileWith(engine?: OcrEngine) {
  return async function collectMenuFile(ctx: CollectorContext): Promise<CollectorResult> {
    const placeId = ctx.source.place_id;
    if (!placeId) throw new Error("A menu file source must be linked to its place (set place_id on the source).");

    const page = await ctx.fetch(ctx.policy.baseUrl, undefined, { binary: true });
    if (page.status !== 200 || !page.bytes) throw new Error(`The menu file returned ${page.status}.`);
    const kind = fileKind(page.contentType, page.url);
    if (!kind) throw new Error(`Unsupported menu file type (${page.contentType ?? "unknown"}). Use a PDF or an image.`);

    const snapshot = await ctx.snapshots.save(ctx.runId, kind === "pdf" ? "menu.pdf" : "menu-image", page.bytes);
    const extracted = await extractMenuText(kind, page.bytes, engine);
    await ctx.snapshots.save(ctx.runId, "menu.txt", extracted.text);
    const menu = parseMenuText(extracted.text);
    ctx.log(
      `${extracted.method}${extracted.confidence !== null ? ` (confidence ${Math.round(extracted.confidence)})` : ""}: ` +
        `${menu.items.length} items, ${menu.unread.length} unread lines`,
    );

    const flags = extracted.method === "ocr" ? ["ocr"] : ["pdf_text"];
    if (extracted.confidence !== null && extracted.confidence < OCR_LOW_CONFIDENCE) flags.push("ocr_low_confidence");
    const messages = [
      extracted.method === "ocr"
        ? "Read by OCR: check every name and price against the menu image."
        : "Read from the PDF's text: check sizes and prices against the PDF.",
      ...menu.warnings,
      ...(menu.unread.length ? [`Lines not read: ${menu.unread.slice(0, 8).join(" | ")}${menu.unread.length > 8 ? " …" : ""}`] : []),
    ];

    const summary = await withActor(ctx.db, SERVICE, async (tx) => {
      const drinkTypes = await tx.query<{ slug: string; aliases: string[] }>("select slug, aliases from drink_types");
      const records = menuItemsToRecords(menu.items, {
        placeId,
        drinkTypes,
        channel: "dine_in",
        sourceUrl: page.url,
        // An image the cafe publishes is the proof; a PDF is linked as the source.
        proofImageUrl: kind === "image" ? page.url : null,
        confidence: ctx.source.default_confidence,
        capturedAt: new Date().toISOString(),
      });
      return stageRecords(tx, {
        sourceId: ctx.source.id,
        runId: ctx.runId,
        records,
        evidenceUrl: page.url,
        extraFlags: flags,
        extraMessages: messages,
      });
    });
    ctx.log(`staged ${summary.staged}, re-confirmed ${summary.reconfirmed}, rejected ${summary.rejected}`);

    if (menu.items.length === 0) throw new Error("No prices could be read from the menu file.");
    return {
      found: menu.items.reduce((n, i) => n + i.prices.length, 0),
      staged: summary.staged,
      partial: summary.rejected > 0 || menu.unread.length > 0,
      rawSnapshotUrl: snapshot,
    };
  };
}

export const collectMenuFile = collectMenuFileWith();
