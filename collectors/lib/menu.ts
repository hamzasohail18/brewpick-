// Shared by the menu collectors (website, menu file/OCR): turns parsed menu lines into the same
// PriceRecord / NutritionRecord shapes the capture form and CSV import produce. No I/O.

import { matchDrinkType, parseSize, type DrinkTypeAliases } from "@/lib/pipeline/normalize";
import type { ConfidenceLevel } from "@/lib/domain/sources";

export interface ParsedPrice {
  /** Size as the menu writes it ("Small", "12 oz"); null when the item has one price. */
  label: string | null;
  price_pkr: number;
}

export interface ParsedMenuItem {
  name: string;
  section: string | null;
  prices: ParsedPrice[];
  /** Only when the cafe publishes it (e.g. schema.org nutrition). Never estimated here. */
  calories_kcal?: number | null;
}

export interface MenuRecordOptions {
  placeId: string;
  drinkTypes: DrinkTypeAliases[];
  channel: "dine_in" | "takeaway" | "delivery";
  sourceUrl: string | null;
  proofImageUrl?: string | null;
  confidence: ConfidenceLevel;
  capturedAt: string;
}

function temperature(name: string): "hot" | "iced" | null {
  if (/\b(iced|ice|cold|frapp\w*|frozen|chilled)\b/i.test(name)) return "iced";
  if (/\bhot\b/i.test(name)) return "hot";
  return null;
}

/** One PriceRecord per size, plus a NutritionRecord where the menu states calories for that size. */
export function menuItemsToRecords(items: ParsedMenuItem[], o: MenuRecordOptions): unknown[] {
  const out: unknown[] = [];
  const provenance = {
    source_url: o.sourceUrl,
    proof_image_url: o.proofImageUrl ?? null,
    confidence: o.confidence,
    captured_at: o.capturedAt,
  };
  for (const item of items) {
    const drink = matchDrinkType(item.name, o.drinkTypes);
    for (const p of item.prices) {
      const size = parseSize(p.label);
      out.push({
        kind: "item_price",
        place_id: o.placeId,
        item: { display_name: item.name, drink_type_slug: drink?.slug ?? null, temperature: temperature(item.name), has_milk: null },
        size,
        channel: o.channel,
        price_pkr: p.price_pkr,
        tax_inclusive: null,
        ...provenance,
      });
      if (item.calories_kcal != null && item.prices.length === 1) {
        out.push({
          kind: "nutrition",
          place_id: o.placeId,
          item_display_name: item.name,
          size_label: size.size_label,
          volume_ml: size.volume_is_assumed ? null : size.volume_ml,
          calories_kcal: item.calories_kcal,
          assumptions: null,
          ...provenance,
        });
      }
    }
  }
  return out;
}

/** Collapse duplicates (same name + size) the parser may find twice on one page; first one wins. */
export function dedupeItems(items: ParsedMenuItem[]): ParsedMenuItem[] {
  const seen = new Set<string>();
  const out: ParsedMenuItem[] = [];
  for (const it of items) {
    const prices = it.prices.filter((p) => {
      const key = `${it.name.toLowerCase()}|${(p.label ?? "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (prices.length) out.push({ ...it, prices });
  }
  return out;
}
