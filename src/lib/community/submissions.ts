// Community and owner submissions (Section 3G). A submission is stored as sent (submissions table) and,
// when it carries structured data, turned into staged records in the normal review queue with the photo
// as evidence. Nothing a user sends reaches live tables without a reviewer, except exact
// re-confirmations, which the pipeline auto-applies as it does for every source.
//
// Run these as SERVICE inside the request handler, after checking who the user is: staging_records
// and the source registry aren't writable by users, by design.

import { z } from "zod";
import type { Db } from "@/lib/db/core";
import { HoursEntry } from "@/lib/pipeline/records";
import { matchDrinkType, parseSize } from "@/lib/pipeline/normalize";
import { stageRecords, type StageSummary } from "@/lib/pipeline/stage";
import { ensureProfile } from "@/lib/profile/repo";
import { PROOF_REQUIRED, type SubmissionType } from "./types";

export { PROOF_REQUIRED, SUBMISSION_TYPES, type SubmissionType } from "./types";


const price = z.number().int().min(50).max(5000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SubmissionPayload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("price_correction"),
    item_size_id: z.guid(),
    price_pkr: price,
    channel: z.enum(["dine_in", "takeaway", "delivery"]).default("dine_in"),
    tax_inclusive: z.boolean().nullable().default(null),
  }),
  z.object({
    type: z.literal("new_item"),
    display_name: z.string().trim().min(2).max(80),
    size_label: z.string().trim().min(1).max(30).default("Regular"),
    volume_ml: z.number().int().min(15).max(2000).nullable().default(null),
    price_pkr: price,
    temperature: z.enum(["hot", "iced"]).nullable().default(null),
  }),
  z.object({
    type: z.literal("new_deal"),
    title: z.string().trim().min(3).max(120),
    deal_type: z.enum(["bank_card", "delivery_app", "loyalty", "happy_hour", "combo", "student", "other"]),
    discount: z.enum(["percent", "flat_pkr", "bogo", "fixed_price", "free_item"]),
    discount_value: z.number().min(0).max(5000).nullable().default(null),
    max_discount_pkr: z.number().int().min(0).nullable().default(null),
    min_spend_pkr: z.number().int().min(0).nullable().default(null),
    valid_to: date,
    days_of_week: z.array(z.number().int().min(0).max(6)).min(1).max(7).nullable().default(null),
    start_time: time.nullable().default(null),
    end_time: time.nullable().default(null),
    payment_methods: z.array(z.string().max(60)).max(10).default([]),
    terms: z.string().trim().max(500).nullable().default(null),
    source_url: z.url({ protocol: /^https?$/ }).nullable().default(null),
  }),
  z.object({
    type: z.literal("hours_correction"),
    hours: z.array(HoursEntry).length(7),
  }),
  z.object({
    type: z.literal("other"),
    message: z.string().trim().min(5).max(1000),
  }),
]);
export type SubmissionPayload = z.infer<typeof SubmissionPayload>;

/** Daily limit per user across submissions, reports and claims, to keep the queue reviewable. */
export const DAILY_LIMIT = 20;

export class SubmissionRejected extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "SubmissionRejected";
  }
}

export interface SubmissionResult {
  id: string;
  /** The user owns this place (approved claim), so it went in as an owner update. */
  asOwner: boolean;
  staged: StageSummary | null;
  status: "pending_review" | "published" | "rejected";
}

export async function countToday(db: Db, userId: string): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `select (select count(*) from submissions where user_id = $1 and created_at > now() - interval '1 day')
          + (select count(*) from reports where user_id = $1 and created_at > now() - interval '1 day')
          + (select count(*) from place_claims where user_id = $1 and created_at > now() - interval '1 day') as n`,
    [userId],
  );
  return Number(r.n);
}

export async function createSubmission(
  db: Db,
  opts: { userId: string; placeId: string; payload: SubmissionPayload; note: string | null; proofUrl: string | null; now?: Date },
): Promise<SubmissionResult> {
  const p = opts.payload;
  return db.transaction(async (tx) => {
    const [place] = await tx.query<Record<string, unknown>>(
      "select * from places where id = $1 and status = 'published'",
      [opts.placeId],
    );
    if (!place) throw new SubmissionRejected("That place isn't in the directory.", 404);
    if (PROOF_REQUIRED[p.type] && !opts.proofUrl) throw new SubmissionRejected("Add a photo of the menu or offer as proof.");
    if ((await countToday(tx, opts.userId)) >= DAILY_LIMIT) {
      throw new SubmissionRejected("You've sent a lot today. Thanks! Please try again tomorrow.", 429);
    }
    await ensureProfile(tx, opts.userId);

    // Readable by the owner themselves (RLS own_read) and by the service role.
    const asOwner = (await tx.query("select 1 from place_owners where place_id = $1 and user_id = $2", [opts.placeId, opts.userId])).length > 0;
    const sourceSlug = asOwner ? "owner-portal" : "community-submissions";
    const [source] = await tx.query<{ id: string }>("select id from sources where slug = $1", [sourceSlug]);
    if (!source) throw new Error(`Source ${sourceSlug} is missing from the registry.`);
    const confidence = asOwner ? "verified" : "community_reported";
    const capturedAt = (opts.now ?? new Date()).toISOString();

    const [sub] = await tx.query<{ id: string }>(
      `insert into submissions (user_id, type, place_id, payload, proof_image_url, note, status)
       values ($1, $2::submission_type, $3, $4, $5, $6, 'pending_review') returning id`,
      [opts.userId, p.type, opts.placeId, JSON.stringify(p), opts.proofUrl, opts.note],
    );

    const records = await buildRecords(tx, place, p, { confidence, proofUrl: opts.proofUrl, capturedAt });
    let staged: StageSummary | null = null;
    if (records) {
      staged = await stageRecords(tx, {
        sourceId: source.id,
        records,
        evidenceUrl: opts.proofUrl,
        submissionId: sub.id,
        actor: { id: opts.userId, kind: asOwner ? "owner" : "community" },
        extraFlags: [asOwner ? "owner_update" : "community"],
        extraMessages: [
          asOwner ? "Sent by the verified owner of this place." : "Sent by a community member.",
          ...(opts.note ? [`Note from the sender: ${opts.note}`] : []),
        ],
      });
    }
    const status = await refreshSubmissionStatus(tx, sub.id);
    return { id: sub.id, asOwner, staged, status };
  });
}

type PlaceRow = Record<string, unknown>;

async function buildRecords(
  tx: Db,
  place: PlaceRow,
  p: SubmissionPayload,
  ctx: { confidence: string; proofUrl: string | null; capturedAt: string },
): Promise<unknown[] | null> {
  const provenance = { source_url: null, proof_image_url: ctx.proofUrl, confidence: ctx.confidence, captured_at: ctx.capturedAt };
  switch (p.type) {
    case "price_correction": {
      const [size] = await tx.query<{ display_name: string; drink_slug: string | null; temperature: string; has_milk: boolean | null; size_label: string; volume_ml: number | null; volume_is_assumed: boolean }>(
        `select mi.display_name, dt.slug as drink_slug, mi.temperature, mi.has_milk, s.size_label, s.volume_ml, s.volume_is_assumed
           from item_sizes s join menu_items mi on mi.id = s.menu_item_id left join drink_types dt on dt.id = mi.drink_type_id
          where s.id = $1 and mi.place_id = $2 and mi.status = 'published'`,
        [p.item_size_id, place.id],
      );
      if (!size) throw new SubmissionRejected("That drink isn't on this place's menu.");
      // "Not sure" about tax keeps what we already know, rather than erasing it.
      const [live] = await tx.query<{ tax_inclusive: boolean | null }>(
        "select tax_inclusive from item_prices where item_size_id = $1 and channel = $2 and is_current",
        [p.item_size_id, p.channel],
      );
      const taxInclusive = p.tax_inclusive ?? live?.tax_inclusive ?? null;
      return [
        {
          kind: "item_price",
          place_id: place.id,
          item: { display_name: size.display_name, drink_type_slug: size.drink_slug, temperature: size.temperature, has_milk: size.has_milk },
          size: { size_label: size.size_label, volume_ml: size.volume_ml, volume_is_assumed: size.volume_is_assumed },
          channel: p.channel,
          price_pkr: p.price_pkr,
          tax_inclusive: taxInclusive,
          ...provenance,
        },
      ];
    }
    case "new_item": {
      const types = await tx.query<{ slug: string; aliases: string[] }>("select slug, aliases from drink_types");
      const drink = matchDrinkType(p.display_name, types);
      return [
        {
          kind: "item_price",
          place_id: place.id,
          item: { display_name: p.display_name, drink_type_slug: drink?.slug ?? null, temperature: p.temperature, has_milk: null },
          size: parseSize(p.size_label, p.volume_ml),
          channel: "dine_in",
          price_pkr: p.price_pkr,
          tax_inclusive: null,
          ...provenance,
        },
      ];
    }
    case "new_deal": {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(ctx.capturedAt));
      return [
        {
          kind: "deal",
          place_id: place.id,
          brand_id: null,
          title: p.title,
          deal_type: p.deal_type,
          discount: p.discount,
          discount_value: p.discount_value,
          max_discount_pkr: p.max_discount_pkr,
          min_spend_pkr: p.min_spend_pkr,
          valid_from: today,
          valid_to: p.valid_to,
          days_of_week: p.days_of_week,
          start_time: p.start_time,
          end_time: p.end_time,
          terms: p.terms,
          payment_methods: p.payment_methods,
          item_names: [],
          conditions: [],
          ...provenance,
          source_url: p.source_url,
        },
      ];
    }
    case "hours_correction":
      // A place record carrying the live details plus the new hours: the diff shows only the hours.
      return [
        {
          kind: "place",
          name: place.name,
          branch_name: place.branch_name,
          type: place.type,
          area_id: place.area_id,
          address: place.address,
          lat: Number(place.lat),
          lng: Number(place.lng),
          phone: place.phone,
          website_url: place.website_url,
          instagram_handle: place.instagram_handle,
          osm_id: place.osm_id,
          google_place_id: place.google_place_id,
          halal_certified: place.halal_certified,
          has_wifi: place.has_wifi,
          has_family_seating: place.has_family_seating,
          has_drive_thru: place.has_drive_thru,
          hours: p.hours,
          ...provenance,
        },
      ];
    case "other":
      return null; // free text: handled on the moderation screen
  }
}

/**
 * A submission's status follows its staged records: pending while any is waiting, published if any was
 * published (including auto-applied re-confirmations), otherwise rejected. Free-text submissions (no
 * staged records) keep the status a moderator gives them.
 */
export async function refreshSubmissionStatus(tx: Db, submissionId: string): Promise<SubmissionResult["status"]> {
  const rows = await tx.query<{ status: string; reviewed_by: string | null }>(
    "select status, reviewed_by from staging_records where submission_id = $1 order by reviewed_at desc nulls first",
    [submissionId],
  );
  const [current] = await tx.query<{ status: SubmissionResult["status"] }>("select status from submissions where id = $1", [submissionId]);
  if (rows.length === 0) return current?.status ?? "pending_review";
  const status = rows.some((r) => r.status === "pending_review")
    ? "pending_review"
    : rows.some((r) => r.status === "published")
      ? "published"
      : "rejected";
  const note =
    status === "rejected"
      ? (await tx.query<{ review_note: string | null }>(
          "select review_note from staging_records where submission_id = $1 and review_note is not null order by reviewed_at desc limit 1",
          [submissionId],
        ))[0]?.review_note ?? null
      : null;
  await tx.query(
    `update submissions set status = $2::record_status,
            reviewed_at = case when $2::record_status = 'pending_review' then null else now() end,
            reviewed_by = case when $2::record_status = 'pending_review' then null else $3::uuid end,
            review_note = $4
      where id = $1 and status is distinct from $2::record_status`,
    [submissionId, status, rows.find((r) => r.reviewed_by)?.reviewed_by ?? null, note],
  );
  return status;
}

/** After a reviewer decides a staged record, bring its submission's status up to date. */
export async function syncSubmissionForStaged(tx: Db, stagingId: string): Promise<void> {
  const [row] = await tx.query<{ submission_id: string | null }>("select submission_id from staging_records where id = $1", [stagingId]);
  if (row?.submission_id) await refreshSubmissionStatus(tx, row.submission_id);
}

export interface MySubmission {
  id: string;
  type: SubmissionType;
  placeSlug: string | null;
  placeName: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
}

export async function mySubmissions(db: Db, userId: string): Promise<MySubmission[]> {
  const rows = await db.query<{ id: string; type: SubmissionType; slug: string | null; name: string | null; status: string; review_note: string | null; created_at: Date }>(
    `select s.id, s.type, p.slug, p.name, s.status, s.review_note, s.created_at
       from submissions s left join places p on p.id = s.place_id
      where s.user_id = $1 order by s.created_at desc limit 50`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, type: r.type, placeSlug: r.slug, placeName: r.name, status: r.status, reviewNote: r.review_note, createdAt: new Date(r.created_at).toISOString() }));
}
