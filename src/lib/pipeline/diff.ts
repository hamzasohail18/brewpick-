// Diff engine (Section 7.3 step 4): compares a proposed record with the live row it would replace.
// Pure; the live row is looked up by match.ts and projected into the same flat shape as project().

import type { RecordKind, StagedRecord } from "./records";

export const PRICE_CHANGE_FLAG_RATIO = 0.15;

export type DiffFlag = "new_item" | "new_place" | "price_change_over_15pct" | "removed_item";
export type FieldDiff = Record<string, { from: unknown; to: unknown }>;
export type Flat = Record<string, unknown>;

/** Fields that define "the same data" per kind. Provenance fields are not compared. */
export const DIFF_FIELDS: Record<RecordKind, string[]> = {
  item_price: ["price_pkr", "tax_inclusive", "volume_ml"],
  place: [
    "name",
    "branch_name",
    "type",
    "address",
    "lat",
    "lng",
    "phone",
    "website_url",
    "instagram_handle",
    "halal_certified",
    "has_wifi",
    "has_family_seating",
    "has_drive_thru",
  ],
  nutrition: ["calories_kcal", "sugar_g", "caffeine_mg", "fat_g", "protein_g"],
  deal: [
    "deal_type",
    "discount",
    "discount_value",
    "max_discount_pkr",
    "min_spend_pkr",
    "valid_from",
    "valid_to",
    "days_of_week",
    "start_time",
    "end_time",
    "payment_methods",
    "item_names",
    "conditions",
  ],
  bean: ["bean_kind", "origin_country", "origin_region", "roaster", "roast", "arabica_pct", "robusta_pct"],
};

/** Flatten a record into the comparable shape. */
export function project(r: StagedRecord): Flat {
  if (r.kind === "item_price") {
    return {
      price_pkr: r.price_pkr,
      tax_inclusive: r.tax_inclusive,
      // An assumed default volume says nothing about the real cup, so it's no claim at all.
      volume_ml: r.size.volume_is_assumed ? null : r.size.volume_ml,
    };
  }
  return { ...r };
}

const norm = (v: unknown): unknown => {
  if (v === undefined || v === "") return null;
  if (Array.isArray(v)) return JSON.stringify([...v].map(String).sort());
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (typeof v === "string" && /^\d{2}:\d{2}:\d{2}$/.test(v)) return v.slice(0, 5); // time from Postgres
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
};

function equal(field: string, a: unknown, b: unknown) {
  if ((field === "lat" || field === "lng") && a !== null && b !== null) return Math.abs(Number(a) - Number(b)) < 0.0005; // ~50 m
  return norm(a) === norm(b);
}

export interface DiffResult {
  action: "create" | "update" | "reconfirm";
  diff: FieldDiff;
  flags: DiffFlag[];
}

/**
 * - no live row      -> create (flag new_item / new_place)
 * - nothing differs  -> reconfirm (auto-approved: only bumps last_verified_at)
 * - something differs -> update, with a field-by-field diff
 * A proposed null means "the source doesn't say", never "clear this field".
 */
export function diffRecord(kind: RecordKind, current: Flat | null, proposed: StagedRecord): DiffResult {
  const p = project(proposed);
  if (!current) {
    return {
      action: "create",
      diff: {},
      flags: kind === "place" ? ["new_place"] : kind === "item_price" ? ["new_item"] : [],
    };
  }
  const diff: FieldDiff = {};
  for (const f of DIFF_FIELDS[kind]) {
    const to = p[f];
    if (to === null || to === undefined) continue;
    if (Array.isArray(to) && to.length === 0 && (current[f] === null || current[f] === undefined)) continue;
    if (!equal(f, current[f], to)) diff[f] = { from: current[f] ?? null, to };
  }
  const flags: DiffFlag[] = [];
  const priceChange = diff.price_pkr;
  if (priceChange && typeof priceChange.from === "number" && priceChange.from > 0) {
    const ratio = Math.abs((priceChange.to as number) - priceChange.from) / priceChange.from;
    if (ratio > PRICE_CHANGE_FLAG_RATIO) flags.push("price_change_over_15pct");
  }
  return { action: Object.keys(diff).length ? "update" : "reconfirm", diff, flags };
}
