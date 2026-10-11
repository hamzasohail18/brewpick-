// Shapes of normalized records as they sit in staging_records.proposed. Collectors, the CSV importer
// and (later) community submissions all produce these; the publisher consumes them.

import { z } from "zod";
import { CONFIDENCE_LEVELS } from "@/lib/domain/sources";

const confidence = z.enum(CONFIDENCE_LEVELS);
const url = z.url({ protocol: /^https?$/ });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24h HH:MM");

const provenance = {
  source_url: url.nullable(),
  proof_image_url: url.nullable().default(null),
  confidence,
  captured_at: z.iso.datetime({ offset: true }),
};

export const HoursEntry = z.object({
  day_of_week: z.number().int().min(0).max(6), // 0 = Sunday
  opens: time.nullable(),
  closes: time.nullable(),
  is_closed: z.boolean(),
});
export type HoursEntry = z.infer<typeof HoursEntry>;

/** "1:08:00-22:00" / "0:closed": a comparable, order-independent form of a week's hours. */
export const hoursKeys = (hours: HoursEntry[]) =>
  [...hours].sort((a, b) => a.day_of_week - b.day_of_week).map((h) => `${h.day_of_week}:${h.is_closed ? "closed" : `${h.opens}-${h.closes}`}`);

export const PriceRecord = z.object({
  kind: z.literal("item_price"),
  place_id: z.guid(),
  item: z.object({
    display_name: z.string().trim().min(1),
    drink_type_slug: z.string().nullable().default(null),
    temperature: z.enum(["hot", "iced", "both"]).nullable().default(null),
    has_milk: z.boolean().nullable().default(null),
  }),
  size: z.object({
    size_label: z.string().trim().min(1),
    volume_ml: z.number().int().positive().nullable(),
    volume_is_assumed: z.boolean(),
  }),
  channel: z.enum(["dine_in", "takeaway", "delivery"]),
  price_pkr: z.number().int(),
  tax_inclusive: z.boolean().nullable(),
  ...provenance,
});

export const PlaceRecord = z.object({
  kind: z.literal("place"),
  name: z.string().trim().min(1),
  branch_name: z.string().trim().nullable().default(null),
  type: z.enum(["specialty_cafe", "chain", "kiosk_drive_thru", "bakery_cafe"]),
  area_id: z.number().int().nullable().default(null),
  address: z.string().trim().nullable().default(null),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().trim().nullable().default(null),
  website_url: url.nullable().default(null),
  instagram_handle: z.string().trim().nullable().default(null),
  osm_id: z.string().nullable().default(null),
  google_place_id: z.string().nullable().default(null),
  halal_certified: z.boolean().nullable().default(null),
  has_wifi: z.boolean().nullable().default(null),
  has_family_seating: z.boolean().nullable().default(null),
  has_drive_thru: z.boolean().nullable().default(null),
  /** Weekly hours; null = the source doesn't say. One range per day (Asia/Karachi, may close after midnight). */
  hours: z.array(HoursEntry).nullable().default(null),
  ...provenance,
});

export const NutritionRecord = z.object({
  kind: z.literal("nutrition"),
  place_id: z.guid(),
  item_display_name: z.string().trim().min(1),
  size_label: z.string().trim().min(1),
  milk_type_slug: z.string().nullable().default(null),
  volume_ml: z.number().int().positive().nullable().default(null),
  has_milk: z.boolean().nullable().default(null),
  calories_kcal: z.number().int().min(0).nullable(),
  sugar_g: z.number().min(0).nullable().default(null),
  caffeine_mg: z.number().int().min(0).nullable().default(null),
  fat_g: z.number().min(0).nullable().default(null),
  protein_g: z.number().min(0).nullable().default(null),
  assumptions: z.string().trim().nullable().default(null),
  ...provenance,
});

export const DealRecord = z.object({
  kind: z.literal("deal"),
  place_id: z.guid().nullable(),
  brand_id: z.guid().nullable().default(null),
  title: z.string().trim().min(1),
  deal_type: z.enum(["bank_card", "delivery_app", "loyalty", "happy_hour", "combo", "student", "other"]),
  discount: z.enum(["percent", "flat_pkr", "bogo", "fixed_price", "free_item"]),
  discount_value: z.number().min(0).nullable(),
  max_discount_pkr: z.number().int().min(0).nullable().default(null),
  min_spend_pkr: z.number().int().min(0).nullable().default(null),
  valid_from: date,
  valid_to: date,
  days_of_week: z.array(z.number().int().min(0).max(6)).nullable().default(null),
  start_time: time.nullable().default(null),
  end_time: time.nullable().default(null),
  terms: z.string().nullable().default(null),
  /** Payment method names as in payment_methods.name; empty = open to everyone. */
  payment_methods: z.array(z.string()).default([]),
  /** Menu item display names; empty = applies to all items. */
  item_names: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  ...provenance,
});

export const BeanRecord = z.object({
  kind: z.literal("bean"),
  place_id: z.guid(),
  item_display_name: z.string().trim().nullable().default(null), // null = house beans
  bean_kind: z.enum(["single_origin", "blend"]).nullable().default(null),
  origin_country: z.string().trim().nullable().default(null),
  origin_region: z.string().trim().nullable().default(null),
  roaster: z.string().trim().nullable().default(null),
  roast: z.enum(["light", "medium_light", "medium", "medium_dark", "dark"]).nullable().default(null),
  arabica_pct: z.number().int().min(0).max(100).nullable().default(null),
  robusta_pct: z.number().int().min(0).max(100).nullable().default(null),
  tasting_notes: z.string().nullable().default(null),
  ...provenance,
});

export const StagedRecord = z.discriminatedUnion("kind", [PriceRecord, PlaceRecord, NutritionRecord, DealRecord, BeanRecord]);
export type StagedRecord = z.infer<typeof StagedRecord>;
export type PriceRecord = z.infer<typeof PriceRecord>;
export type PlaceRecord = z.infer<typeof PlaceRecord>;
export type NutritionRecord = z.infer<typeof NutritionRecord>;
export type DealRecord = z.infer<typeof DealRecord>;
export type BeanRecord = z.infer<typeof BeanRecord>;
export type RecordKind = StagedRecord["kind"];

export const TARGET_TABLE: Record<RecordKind, string> = {
  item_price: "item_prices",
  place: "places",
  nutrition: "nutrition_info",
  deal: "deals",
  bean: "bean_info",
};

export const KIND_TITLES: Record<RecordKind, string> = {
  item_price: "Price",
  place: "Place",
  nutrition: "Nutrition",
  deal: "Deal",
  bean: "Beans",
};
