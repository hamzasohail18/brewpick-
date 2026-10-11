// Manual deal entry (/admin/deals/new): the fallback for bank offer pages that may not be scraped,
// and the way staff add promos seen on Instagram/Facebook. Builds a DealRecord from the form; it is
// staged and reviewed like everything else.

import { z } from "zod";
import type { Db } from "@/lib/db/core";
import { stageRecords } from "@/lib/pipeline/stage";

/** Sources a person can type a deal in from. Bank pages are listed whatever their automation status. */
export const MANUAL_DEAL_SOURCE_KINDS = ["bank_offer_page", "social_manual", "delivery_app_manual", "manual_admin"] as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optInt = z.preprocess(blank, z.coerce.number().int().min(0).nullable());
const optTime = z.preprocess(blank, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable());

export const ManualDealForm = z
  .object({
    source: z.string().min(1, "Choose where the deal is published"),
    applies_to: z.string().regex(/^(place|brand):[0-9a-f-]{36}$/, "Choose the cafe or brand"),
    title: z.string().trim().min(3, "Add a short title").max(120),
    deal_type: z.enum(["bank_card", "delivery_app", "loyalty", "happy_hour", "combo", "student", "other"]),
    discount: z.enum(["percent", "flat_pkr", "bogo", "fixed_price", "free_item"]),
    discount_value: z.preprocess(blank, z.coerce.number().min(0).nullable()),
    max_discount_pkr: optInt,
    min_spend_pkr: optInt,
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required"),
    valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date is required (as stated by the source)"),
    days: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    start_time: optTime,
    end_time: optTime,
    payment_methods: z.array(z.string()).default([]),
    terms: z.preprocess(blank, z.string().trim().max(1000).nullable()),
    source_url: z.preprocess(blank, z.url({ protocol: /^https?$/, message: "Use the full https:// address" }).nullable()),
  })
  .superRefine((d, ctx) => {
    if (["percent", "flat_pkr", "fixed_price"].includes(d.discount) && d.discount_value === null)
      ctx.addIssue({ code: "custom", path: ["discount_value"], message: "How much off?" });
    if (d.discount === "percent" && (d.discount_value ?? 0) > 100) ctx.addIssue({ code: "custom", path: ["discount_value"], message: "A percentage is at most 100" });
    if (d.valid_to && d.valid_from && d.valid_to < d.valid_from) ctx.addIssue({ code: "custom", path: ["valid_to"], message: "Ends before it starts" });
    if (d.deal_type === "bank_card" && d.payment_methods.length === 0)
      ctx.addIssue({ code: "custom", path: ["payment_methods"], message: "Which bank's cards?" });
    if ((d.start_time === null) !== (d.end_time === null)) ctx.addIssue({ code: "custom", path: ["end_time"], message: "Give both times or neither" });
  });
export type ManualDealForm = z.infer<typeof ManualDealForm>;

/** FormData -> plain object (multi-value fields as arrays). */
export function manualDealFields(fd: FormData) {
  const one = (k: string) => (fd.get(k) ?? "") as string;
  return {
    ...Object.fromEntries(
      ["source", "applies_to", "title", "deal_type", "discount", "discount_value", "max_discount_pkr", "min_spend_pkr", "valid_from", "valid_to", "start_time", "end_time", "terms", "source_url"].map((k) => [k, one(k)]),
    ),
    days: fd.getAll("days").map(String),
    payment_methods: fd.getAll("payment_methods").map(String),
  };
}

export function toDealRecord(d: ManualDealForm, o: { proofImageUrl: string | null; confidence: string; capturedAt: string }) {
  const [kind, id] = d.applies_to.split(":");
  return {
    kind: "deal",
    place_id: kind === "place" ? id : null,
    brand_id: kind === "brand" ? id : null,
    title: d.title,
    deal_type: d.deal_type,
    discount: d.discount,
    discount_value: d.discount_value,
    max_discount_pkr: d.max_discount_pkr,
    min_spend_pkr: d.min_spend_pkr,
    valid_from: d.valid_from,
    valid_to: d.valid_to,
    days_of_week: d.days.length && d.days.length < 7 ? [...new Set(d.days)].sort((a, b) => a - b) : null,
    start_time: d.start_time,
    end_time: d.end_time,
    terms: d.terms,
    payment_methods: d.payment_methods,
    item_names: [],
    conditions: [],
    source_url: d.source_url,
    proof_image_url: o.proofImageUrl,
    confidence: o.confidence,
    captured_at: o.capturedAt,
  };
}

/** Stages the deal. Returns the validator's messages if it was rejected. */
export async function stageManualDeal(db: Db, adminId: string, d: ManualDealForm, proofImageUrl: string | null) {
  const [source] = await db.query<{ id: string; kind: string; default_confidence: string }>(
    "select id, kind::text, default_confidence::text from sources where slug = $1 and is_active",
    [d.source],
  );
  if (!source || d.source === "sample-data" || !(MANUAL_DEAL_SOURCE_KINDS as readonly string[]).includes(source.kind)) {
    return { error: "Choose a source you can enter deals from." };
  }
  if (source.kind === "bank_offer_page" && !d.source_url) return { error: "Bank offers need the offer page's address as the source URL." };
  if (!d.source_url && !proofImageUrl) return { error: "Add the source URL or a screenshot." };

  const summary = await stageRecords(db, {
    sourceId: source.id,
    records: [toDealRecord(d, { proofImageUrl, confidence: source.default_confidence, capturedAt: new Date().toISOString() })],
    actor: { id: adminId, kind: "admin" },
    extraMessages: ["Entered by hand from the source; check it against the page or screenshot."],
  });
  if (summary.rejected) {
    const [row] = await db.query<{ messages: string[] }>(
      "select messages from staging_records where source_id = $1 and status = 'rejected' order by created_at desc limit 1",
      [source.id],
    );
    return { error: `The validator refused it: ${row?.messages.join(" ") ?? "unknown reason"}` };
  }
  return { staged: summary.staged, reconfirmed: summary.reconfirmed };
}
