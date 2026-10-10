// Validator (Section 7.3 step 3). Errors reject a record outright; flags let it through to the
// review queue with a warning the reviewer must look at.

import { StagedRecord, type DealRecord, type NutritionRecord, type PlaceRecord, type PriceRecord, type BeanRecord } from "./records";
import { karachiDate } from "./normalize";

export const PRICE_FLAG_RANGE = { min: 100, max: 3000 } as const; // outside = flag
export const PRICE_HARD_RANGE = { min: 50, max: 5000 } as const; // outside = reject (matches the DB check)
export const LAHORE_BBOX = { minLat: 31.2, maxLat: 31.75, minLng: 74.0, maxLng: 74.6 } as const;

export type Flag =
  | "price_out_of_range"
  | "calories_implausible"
  | "caffeine_high"
  | "volume_assumed"
  | "outside_lahore"
  | "deal_expired"
  | "deal_expires_soon"
  | "discount_over_50pct"
  | "unknown_drink_type";

export interface Validation {
  record: StagedRecord | null;
  errors: string[];
  flags: Flag[];
  warnings: string[];
}

export function validateRecord(input: unknown, opts: { today?: string } = {}): Validation {
  const parsed = StagedRecord.safeParse(input);
  if (!parsed.success) {
    return {
      record: null,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`),
      flags: [],
      warnings: [],
    };
  }
  const r = parsed.data;
  const out: Validation = { record: r, errors: [], flags: [], warnings: [] };
  const flag = (f: Flag, why: string) => {
    if (!out.flags.includes(f)) out.flags.push(f);
    out.warnings.push(why);
  };

  // Every record needs a way to check it: a source URL or a proof image.
  if (!r.source_url && !r.proof_image_url) out.errors.push("Missing source URL (or proof image).");

  switch (r.kind) {
    case "item_price":
      checkPrice(r, out, flag);
      break;
    case "place":
      checkPlace(r, flag);
      break;
    case "nutrition":
      checkNutrition(r, out, flag);
      break;
    case "deal":
      checkDeal(r, out, flag, opts.today ?? karachiDate());
      break;
    case "bean":
      checkBean(r, out);
      break;
  }
  return out;
}

type FlagFn = (f: Flag, why: string) => void;

function checkPrice(r: PriceRecord, out: Validation, flag: FlagFn) {
  if (r.price_pkr < PRICE_HARD_RANGE.min || r.price_pkr > PRICE_HARD_RANGE.max)
    out.errors.push(`Price Rs. ${r.price_pkr} is outside Rs. ${PRICE_HARD_RANGE.min}–${PRICE_HARD_RANGE.max}; probably a parsing error.`);
  else if (r.price_pkr < PRICE_FLAG_RANGE.min || r.price_pkr > PRICE_FLAG_RANGE.max)
    flag("price_out_of_range", `Price Rs. ${r.price_pkr} is outside the usual Rs. ${PRICE_FLAG_RANGE.min}–${PRICE_FLAG_RANGE.max}.`);
  if (r.size.volume_is_assumed) flag("volume_assumed", `Volume ${r.size.volume_ml} ml is a default, not stated by the source.`);
  if (!r.item.drink_type_slug) flag("unknown_drink_type", `"${r.item.display_name}" didn't match a known drink type.`);
}

function checkPlace(r: PlaceRecord, flag: FlagFn) {
  const b = LAHORE_BBOX;
  if (r.lat < b.minLat || r.lat > b.maxLat || r.lng < b.minLng || r.lng > b.maxLng)
    flag("outside_lahore", `Coordinates ${r.lat}, ${r.lng} are outside Lahore.`);
}

/**
 * Plausibility of calories for the cup size. Bounds are deliberately loose: they catch unit and
 * parsing mistakes (kJ for kcal, a missing digit), not recipe differences.
 */
export function caloriesPlausible(kcal: number, volumeMl: number, hasMilk: boolean | null): { ok: boolean; why?: string } {
  const perMl = kcal / volumeMl;
  if (perMl > 1.3) return { ok: false, why: `${kcal} kcal in ${volumeMl} ml is more than even a whipped-cream frappe.` };
  if (hasMilk === true && perMl < 0.1) return { ok: false, why: `${kcal} kcal in ${volumeMl} ml is too low for a milk drink.` };
  if (hasMilk === false && volumeMl >= 100 && perMl > 0.6)
    return { ok: false, why: `${kcal} kcal in ${volumeMl} ml is high for a drink without milk.` };
  return { ok: true };
}

function checkNutrition(r: NutritionRecord, out: Validation, flag: FlagFn) {
  if (r.confidence === "estimated" && !r.assumptions?.trim())
    out.errors.push("Estimated nutrition must state its assumptions (shots, milk type and volume, syrup).");
  if (r.confidence === "verified" && !r.source_url)
    out.errors.push("Verified nutrition needs the source URL of the published values.");
  if (r.calories_kcal !== null && r.volume_ml) {
    const p = caloriesPlausible(r.calories_kcal, r.volume_ml, r.has_milk);
    if (!p.ok) flag("calories_implausible", p.why!);
  }
  if (r.caffeine_mg !== null && r.caffeine_mg > 400) flag("caffeine_high", `${r.caffeine_mg} mg caffeine in one drink is unusually high.`);
}

function checkDeal(r: DealRecord, out: Validation, flag: FlagFn, today: string) {
  if (r.valid_to < r.valid_from) out.errors.push(`Deal ends (${r.valid_to}) before it starts (${r.valid_from}).`);
  if (!r.place_id && !r.brand_id) out.errors.push("Deal must belong to a place or a brand.");
  if ((r.start_time === null) !== (r.end_time === null)) out.errors.push("Give both a start and an end time, or neither.");
  if (r.discount === "percent" && (r.discount_value ?? 0) > 100) out.errors.push("A percent discount can't exceed 100%.");
  if (["percent", "flat_pkr", "fixed_price"].includes(r.discount) && r.discount_value === null)
    out.errors.push(`A ${r.discount} discount needs a value.`);
  if (r.valid_to < today) flag("deal_expired", `Deal already ended on ${r.valid_to}.`);
  else if (daysBetween(today, r.valid_to) <= 2) flag("deal_expires_soon", `Deal ends on ${r.valid_to}.`);
  if (r.discount === "percent" && (r.discount_value ?? 0) > 50) flag("discount_over_50pct", `${r.discount_value}% off is unusually large.`);
}

function checkBean(r: BeanRecord, out: Validation) {
  if ((r.arabica_pct ?? 0) + (r.robusta_pct ?? 0) > 100) out.errors.push("Arabica + Robusta can't exceed 100%.");
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
