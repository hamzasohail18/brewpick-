// Presentation helpers for the review queue: one-line summaries and a flat, editable view of a
// staged record that round-trips back into the record shape.

import { DIFF_FIELDS, type FieldDiff } from "./diff";
import type { RecordKind } from "./records";

type Json = Record<string, unknown>;
const karachiDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const rs = (n: unknown) => (typeof n === "number" ? `Rs. ${n.toLocaleString("en-PK")}` : "—");

export function recordKind(proposed: Json): RecordKind | "item_price_removal" | null {
  const k = proposed?.kind;
  return typeof k === "string" ? (k as RecordKind) : null;
}

/** "Latte · Regular · Rs. 750 (was Rs. 600)" style headline for lists. */
export function summarize(proposed: Json, current: Json | null, diff: FieldDiff | null): string {
  switch (proposed.kind) {
    case "item_price": {
      const item = proposed.item as Json;
      const size = proposed.size as Json;
      const was = diff?.price_pkr ? ` (was ${rs(diff.price_pkr.from)})` : "";
      return `${item.display_name} · ${size.size_label} · ${rs(proposed.price_pkr)}${was}`;
    }
    case "item_price_removal":
      return `Remove ${proposed.display_name} · ${proposed.size_label}${current?.price_pkr ? ` (${rs(current.price_pkr)})` : ""}`;
    case "place":
      return `${proposed.name}${proposed.branch_name ? ` (${proposed.branch_name})` : ""}`;
    case "nutrition":
      return `${proposed.item_display_name} · ${proposed.size_label} · ${proposed.calories_kcal ?? "?"} kcal${proposed.milk_type_slug ? ` · ${proposed.milk_type_slug} milk` : ""}`;
    case "deal":
      return String(proposed.title);
    case "bean":
      return `${proposed.item_display_name ?? "House beans"}: ${[proposed.origin_country, proposed.roast].filter(Boolean).join(", ") || "details"}`;
    default:
      return "Unreadable record";
  }
}

// ---------- editable fields ----------

export type FieldType = "text" | "number" | "boolean" | "list" | "number_list" | "select";

const NUMBER_FIELDS = new Set([
  "price_pkr", "volume_ml", "lat", "lng", "area_id", "calories_kcal", "sugar_g", "caffeine_mg", "fat_g", "protein_g",
  "discount_value", "max_discount_pkr", "min_spend_pkr", "arabica_pct", "robusta_pct",
]);
const BOOL_FIELDS = new Set([
  "tax_inclusive", "has_milk", "volume_is_assumed", "halal_certified", "has_wifi", "has_family_seating", "has_drive_thru",
]);
const LIST_FIELDS = new Set(["payment_methods", "item_names", "conditions"]);
const NUMBER_LIST_FIELDS = new Set(["days_of_week"]);
export const SELECT_OPTIONS: Record<string, string[]> = {
  channel: ["dine_in", "takeaway", "delivery"],
  confidence: ["verified", "community_reported", "estimated"],
  temperature: ["hot", "iced", "both"],
  type: ["specialty_cafe", "chain", "kiosk_drive_thru", "bakery_cafe"],
  deal_type: ["bank_card", "delivery_app", "loyalty", "happy_hour", "combo", "student", "other"],
  discount: ["percent", "flat_pkr", "bogo", "fixed_price", "free_item"],
  bean_kind: ["single_origin", "blend"],
  roast: ["light", "medium_light", "medium", "medium_dark", "dark"],
};
/** Identity/bookkeeping fields a reviewer shouldn't change from the queue. */
const LOCKED = new Set(["kind", "place_id", "brand_id", "captured_at", "osm_id", "google_place_id", "hours"]);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 08:00–22:00 · Tue closed …" (also accepts the "1:08:00-22:00" key form used in diffs). */
export function formatHours(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return "";
  return v
    .map((h) => {
      if (typeof h === "string") {
        const [d, rest] = [h.slice(0, h.indexOf(":")), h.slice(h.indexOf(":") + 1)];
        return `${DAY_NAMES[Number(d)]} ${rest === "closed" ? "closed" : rest.replace("-", "–")}`;
      }
      const e = h as { day_of_week: number; opens: string; closes: string; is_closed: boolean };
      return `${DAY_NAMES[e.day_of_week]} ${e.is_closed ? "closed" : `${e.opens}–${e.closes}`}`;
    })
    .join(" · ");
}

export interface EditableField {
  path: string; // "price_pkr", "item.display_name"
  label: string;
  type: FieldType;
  value: string; // as shown in the input
  options?: string[];
  locked: boolean;
}

const leaf = (path: string) => path.split(".").pop()!;

export function fieldType(path: string): FieldType {
  const f = leaf(path);
  if (NUMBER_FIELDS.has(f)) return "number";
  if (BOOL_FIELDS.has(f)) return "boolean";
  if (LIST_FIELDS.has(f)) return "list";
  if (NUMBER_LIST_FIELDS.has(f)) return "number_list";
  if (SELECT_OPTIONS[f]) return "select";
  return "text";
}

const humanize = (path: string) =>
  path
    .split(".")
    .map((p) => p.replace(/_pkr$/, " (PKR)").replace(/_ml$/, " (ml)").replace(/_mg$/, " (mg)").replace(/_g$/, " (g)").replace(/_kcal$/, " (kcal)").replace(/_/g, " "))
    .join(" › ")
    .replace(/^./, (c) => c.toUpperCase());

export function toEditableFields(record: Json, prefix = ""): EditableField[] {
  const out: EditableField[] = [];
  for (const [k, v] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...toEditableFields(v as Json, path));
      continue;
    }
    const type = fieldType(path);
    const value =
      v === null || v === undefined
        ? ""
        : k === "hours"
          ? formatHours(v)
          : Array.isArray(v)
            ? v.join(", ")
            : type === "boolean"
              ? (v ? "yes" : "no")
              : String(v);
    out.push({ path, label: humanize(path), type, value, options: SELECT_OPTIONS[leaf(path)], locked: LOCKED.has(k) });
  }
  return out;
}

/** Rebuild a record from submitted field values (keyed by path), coercing by field type. */
export function fromEditableFields(original: Json, submitted: Record<string, string>): Json {
  const copy: Json = structuredClone(original);
  for (const f of toEditableFields(original)) {
    if (f.locked || !(f.path in submitted)) continue;
    const raw = submitted[f.path].trim();
    let value: unknown;
    switch (f.type) {
      case "number":
        value = raw === "" ? null : Number(raw);
        break;
      case "boolean":
        value = raw === "yes" ? true : raw === "no" ? false : null;
        break;
      case "list":
        value = raw === "" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "number_list":
        value = raw === "" ? null : raw.split(",").map((s) => Number(s.trim()));
        break;
      default:
        value = raw === "" ? null : raw;
    }
    const parts = f.path.split(".");
    let target = copy;
    for (const p of parts.slice(0, -1)) target = target[p] as Json;
    target[parts.at(-1)!] = value;
  }
  return copy;
}

/** Rows for the side-by-side table: compared fields first, then everything else proposed. */
export function comparisonRows(kind: RecordKind, proposed: Json, current: Json | null, diff: FieldDiff | null) {
  const flat = Object.fromEntries(toEditableFields(proposed).map((f) => [leaf(f.path), f.value]));
  const compared = DIFF_FIELDS[kind] ?? [];
  const fmt = (v: unknown, f?: string) =>
    f === "hours" ? formatHours(v) || "—" : v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") || "—" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  const rows = compared.map((f) => ({
    field: humanize(f),
    live: current ? fmt(current[f], f) : "—",
    proposed: flat[f] === undefined || flat[f] === "" ? "—" : flat[f],
    changed: Boolean(diff && f in diff),
  }));
  const rest = toEditableFields(proposed)
    .filter((f) => !compared.includes(leaf(f.path)) && !["kind", "place_id", "brand_id"].includes(leaf(f.path)))
    .map((f) => ({
      field: f.label,
      live: "",
      proposed: (leaf(f.path) === "captured_at" && f.value ? karachiDateTime(f.value) : f.value) || "—",
      changed: false,
    }));
  return [...rows, ...rest];
}
