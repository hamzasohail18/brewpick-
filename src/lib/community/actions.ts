// Deal votes, reports, owner claims, the owner portal and the moderation lists.

import { z } from "zod";
import type { Db } from "@/lib/db/core";
import { stageRecords, type StageSummary } from "@/lib/pipeline/stage";
import { ensureProfile } from "@/lib/profile/repo";
import { countToday, DAILY_LIMIT, SubmissionRejected } from "./submissions";
import { REPORT_REASONS } from "./types";

// ---------- deal votes (run as the user: RLS own_rows) ----------

/** true = "it worked", false = "it didn't", null = take my vote back. Only on deals the public can see. */
export async function voteOnDeal(db: Db, userId: string, dealId: string, accurate: boolean | null) {
  const [deal] = await db.query<{ id: string }>("select id from deals where id = $1", [dealId]); // RLS: public deals only
  if (!deal) throw new SubmissionRejected("That deal has ended or doesn't exist.", 404);
  await ensureProfile(db, userId);
  if (accurate === null) {
    await db.query("delete from deal_votes where deal_id = $1 and user_id = $2", [dealId, userId]);
  } else {
    await db.query(
      `insert into deal_votes (deal_id, user_id, is_accurate) values ($1, $2, $3)
       on conflict (deal_id, user_id) do update set is_accurate = excluded.is_accurate, created_at = now()`,
      [dealId, userId, accurate],
    );
  }
  const [counts] = await db.query<{ upvotes: number; downvotes: number }>("select upvotes, downvotes from deals where id = $1", [dealId]);
  return counts;
}

export async function myDealVotes(db: Db, userId: string): Promise<Record<string, boolean>> {
  const rows = await db.query<{ deal_id: string; is_accurate: boolean }>("select deal_id, is_accurate from deal_votes where user_id = $1", [userId]);
  return Object.fromEntries(rows.map((r) => [r.deal_id, r.is_accurate]));
}

/** Deals people say don't work: at least 3 "didn't work" votes and more of those than "worked". */
export const FLAG_MIN_DOWNVOTES = 3;

// ---------- reports (run as the user: RLS own_insert) ----------

export { REPORT_REASONS } from "./types";

export const ReportInput = z.object({
  target_table: z.enum(["places", "deals"]),
  target_id: z.guid(),
  reason: z.enum(Object.keys(REPORT_REASONS) as [keyof typeof REPORT_REASONS, ...(keyof typeof REPORT_REASONS)[]]),
  details: z.string().trim().max(1000).nullable().default(null),
});
export type ReportInput = z.infer<typeof ReportInput>;

export async function createReport(db: Db, userId: string, input: ReportInput): Promise<string> {
  const [target] = await db.query(`select 1 from ${input.target_table} where id = $1`, [input.target_id]); // RLS: visible ones only
  if (!target) throw new SubmissionRejected("We couldn't find what you're reporting.", 404);
  if ((await countToday(db, userId)) >= DAILY_LIMIT) throw new SubmissionRejected("You've sent a lot today. Please try again tomorrow.", 429);
  await ensureProfile(db, userId);
  const [r] = await db.query<{ id: string }>(
    `insert into reports (user_id, target_table, target_id, reason, details, status) values ($1, $2, $3, $4, $5, 'open') returning id`,
    [userId, input.target_table, input.target_id, input.reason, input.details || null],
  );
  return r.id;
}

// ---------- owner claims ----------

export const ClaimInput = z
  .object({
    verification_method: z.enum(["phone_call", "business_email", "document"]),
    contact_name: z.string().trim().min(2).max(100),
    contact_phone: z.string().trim().max(30).nullable().default(null),
    contact_email: z.email().max(200).nullable().default(null),
    note: z.string().trim().max(1000).nullable().default(null),
  })
  .refine((c) => c.verification_method !== "phone_call" || !!c.contact_phone, { message: "Add a phone number we can call.", path: ["contact_phone"] })
  .refine((c) => c.verification_method !== "business_email" || !!c.contact_email, { message: "Add your business email.", path: ["contact_email"] });
export type ClaimInput = z.infer<typeof ClaimInput>;

/** Run as the user (RLS own_insert keeps status pending and user_id = them). */
export async function createClaim(db: Db, userId: string, placeId: string, input: ClaimInput, documentUrl: string | null): Promise<string> {
  const [place] = await db.query<{ claimed_by: string | null }>("select claimed_by from places where id = $1", [placeId]);
  if (!place) throw new SubmissionRejected("That place isn't in the directory.", 404);
  if (input.verification_method === "document" && !documentUrl) throw new SubmissionRejected("Add a photo of a document that shows you run this place.");
  if ((await countToday(db, userId)) >= DAILY_LIMIT) throw new SubmissionRejected("You've sent a lot today. Please try again tomorrow.", 429);
  await ensureProfile(db, userId);
  const existing = await db.query("select 1 from place_claims where place_id = $1 and user_id = $2 and status = 'pending'", [placeId, userId]);
  if (existing.length) throw new SubmissionRejected("You already have a claim waiting for this place.", 409);
  const [c] = await db.query<{ id: string }>(
    `insert into place_claims (place_id, user_id, verification_method, status, contact_name, contact_phone, contact_email, note, document_url)
     values ($1, $2, $3, 'pending', $4, $5, $6, $7, $8) returning id`,
    [placeId, userId, input.verification_method, input.contact_name, input.contact_phone, input.contact_email, input.note, documentUrl],
  );
  return c.id;
}

export async function myClaim(db: Db, userId: string, placeId: string) {
  const [c] = await db.query<{ status: string; created_at: Date; decision_note: string | null }>(
    "select status, created_at, decision_note from place_claims where place_id = $1 and user_id = $2 order by created_at desc limit 1",
    [placeId, userId],
  );
  return c ?? null;
}

/** Admin decision. Approving makes the user the place's owner in BrewPick (places.claimed_by). */
export async function decideClaim(db: Db, adminId: string, claimId: string, approve: boolean, note: string | null) {
  return db.transaction(async (tx) => {
    const [c] = await tx.query<{ id: string; place_id: string; user_id: string; status: string }>(
      "select id, place_id, user_id, status from place_claims where id = $1 for update",
      [claimId],
    );
    if (!c) throw new SubmissionRejected("Claim not found.", 404);
    if (c.status !== "pending") throw new SubmissionRejected(`Already ${c.status}.`, 409);
    if (approve) {
      const [place] = await tx.query<{ claimed_by: string | null }>("select claimed_by from places where id = $1 for update", [c.place_id]);
      if (place.claimed_by && place.claimed_by !== c.user_id) {
        throw new SubmissionRejected("Someone else already owns this place in BrewPick. Remove that first.", 409);
      }
      await tx.query("update places set claimed_by = $2 where id = $1", [c.place_id, c.user_id]);
      await tx.query(
        `insert into audit_log (actor_id, actor_kind, table_name, record_id, action, old_values, new_values)
         values ($1, 'admin', 'places', $2, 'claim_approved', $3, $4)`,
        [adminId, c.place_id, JSON.stringify({ claimed_by: place.claimed_by }), JSON.stringify({ claimed_by: c.user_id, claim_id: c.id })],
      );
    } else if (!note?.trim()) {
      throw new SubmissionRejected("Say why, so the person knows what to send.");
    }
    await tx.query(
      "update place_claims set status = $2, decided_at = now(), decided_by = $3, decision_note = $4 where id = $1",
      [claimId, approve ? "approved" : "rejected", adminId, note?.trim() || null],
    );
  });
}

// ---------- owner portal ----------

export async function ownedPlaces(db: Db, userId: string) {
  return db.query<{ id: string; slug: string; name: string; branch_name: string | null; area_name: string | null; is_sample: boolean; prices: number; oldest_check: Date | null }>(
    `select p.id, p.slug, p.name, p.branch_name, a.name as area_name, p.is_sample,
            (select count(*)::int from item_prices pr join item_sizes s on s.id = pr.item_size_id join menu_items mi on mi.id = s.menu_item_id
              where mi.place_id = p.id and pr.is_current) as prices,
            (select min(coalesce(pr.last_verified_at, pr.captured_at)) from item_prices pr join item_sizes s on s.id = pr.item_size_id
               join menu_items mi on mi.id = s.menu_item_id where mi.place_id = p.id and pr.is_current) as oldest_check
       from places p left join areas a on a.id = p.area_id
      where p.claimed_by = $1 and p.status = 'published' order by p.name`,
    [userId],
  );
}

/**
 * "Everything on my menu is still right": re-confirms every current price as the owner. Unchanged
 * prices are auto-applied by the pipeline and move up to Verified (owner-confirmed).
 * Run as SERVICE after checking the user is signed in; ownership is checked here.
 */
export async function confirmMenu(db: Db, userId: string, placeId: string, now = new Date()): Promise<StageSummary> {
  return db.transaction(async (tx) => {
    const [place] = await tx.query<{ claimed_by: string | null }>("select claimed_by from places where id = $1 and status = 'published'", [placeId]);
    if (!place || place.claimed_by !== userId) throw new SubmissionRejected("Only the verified owner can confirm this menu.", 403);
    const [source] = await tx.query<{ id: string }>("select id from sources where slug = 'owner-portal'");
    const rows = await tx.query<Record<string, unknown>>(
      `select mi.display_name, dt.slug as drink_slug, mi.temperature, mi.has_milk, s.size_label, s.volume_ml, s.volume_is_assumed,
              pr.channel, pr.price_pkr, pr.tax_inclusive
         from item_prices pr join item_sizes s on s.id = pr.item_size_id join menu_items mi on mi.id = s.menu_item_id
         left join drink_types dt on dt.id = mi.drink_type_id
        where mi.place_id = $1 and mi.status = 'published' and pr.is_current`,
      [placeId],
    );
    const records = rows.map((r) => ({
      kind: "item_price",
      place_id: placeId,
      item: { display_name: r.display_name, drink_type_slug: r.drink_slug, temperature: r.temperature, has_milk: r.has_milk },
      size: { size_label: r.size_label, volume_ml: r.volume_ml, volume_is_assumed: r.volume_is_assumed },
      channel: r.channel,
      price_pkr: r.price_pkr,
      tax_inclusive: r.tax_inclusive,
      source_url: null,
      proof_image_url: null,
      confidence: "verified",
      captured_at: now.toISOString(),
    }));
    return stageRecords(tx, {
      sourceId: source.id,
      records,
      actor: { id: userId, kind: "owner" },
      evidenceOptional: true, // the verified owner's account is the evidence; unchanged prices only
      extraMessages: ["Confirmed by the verified owner."],
    });
  });
}

// ---------- moderation (admin) ----------

export async function moderationCounts(db: Db) {
  const [r] = await db.query<{ submissions: number; reports: number; claims: number; deals: number }>(
    `select (select count(*)::int from submissions where status = 'pending_review' and type = 'other') as submissions,
            (select count(*)::int from reports where status = 'open') as reports,
            (select count(*)::int from place_claims where status = 'pending') as claims,
            (select count(*)::int from deals where status = 'published' and downvotes >= ${FLAG_MIN_DOWNVOTES} and downvotes > upvotes) as deals`,
  );
  return r;
}

export async function listSubmissions(db: Db, status: string | null) {
  return db.query<Record<string, unknown>>(
    `select s.id, s.type, s.status, s.note, s.payload, s.proof_image_url, s.review_note, s.created_at, s.user_id,
            p.slug as place_slug, p.name as place_name, p.branch_name,
            (select count(*)::int from staging_records sr where sr.submission_id = s.id and sr.status = 'pending_review') as pending_staged,
            (select sr.id from staging_records sr where sr.submission_id = s.id order by sr.created_at limit 1) as first_staged_id
       from submissions s left join places p on p.id = s.place_id
      where ($1::record_status is null or s.status = $1::record_status)
      order by s.created_at desc limit 100`,
    [status],
  );
}

/** Free-text submissions are closed by a moderator (published = acted on, rejected = not). */
export async function resolveSubmission(db: Db, adminId: string, id: string, accept: boolean, note: string | null) {
  const updated = await db.query(
    `update submissions set status = $2::record_status, reviewed_by = $3, reviewed_at = now(), review_note = $4
      where id = $1 and status = 'pending_review' and type = 'other' returning id`,
    [id, accept ? "published" : "rejected", adminId, note?.trim() || null],
  );
  if (!updated.length) throw new SubmissionRejected("Already handled, or it goes through the review queue.", 409);
}

export async function listReports(db: Db, status: "open" | "resolved" | "dismissed") {
  return db.query<Record<string, unknown>>(
    `select r.id, r.target_table, r.target_id, r.reason, r.details, r.status, r.created_at, r.resolution_note,
            coalesce(p.slug, dp.slug) as place_slug, coalesce(p.name, dp.name) as place_name, d.title as deal_title
       from reports r
       left join places p on r.target_table = 'places' and p.id = r.target_id
       left join deals d on r.target_table = 'deals' and d.id = r.target_id
       left join places dp on dp.id = d.place_id
      where r.status = $1 order by r.created_at desc limit 100`,
    [status],
  );
}

export async function resolveReport(db: Db, adminId: string, id: string, outcome: "resolved" | "dismissed", note: string | null) {
  const updated = await db.query(
    `update reports set status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 where id = $1 and status = 'open' returning id`,
    [id, outcome, adminId, note?.trim() || null],
  );
  if (!updated.length) throw new SubmissionRejected("Already handled.", 409);
}

export async function listClaims(db: Db, status: "pending" | "approved" | "rejected") {
  return db.query<Record<string, unknown>>(
    `select c.*, p.slug as place_slug, p.name as place_name, p.branch_name, p.phone as listed_phone, p.website_url, p.claimed_by
       from place_claims c join places p on p.id = c.place_id
      where c.status = $1 order by c.created_at desc limit 100`,
    [status],
  );
}

export async function flaggedDeals(db: Db) {
  return db.query<Record<string, unknown>>(
    `select d.id, d.title, d.upvotes, d.downvotes, d.valid_to, p.slug as place_slug, coalesce(p.name, b.name) as place_name
       from deals d left join places p on p.id = d.place_id left join brands b on b.id = d.brand_id
      where d.status = 'published' and d.downvotes >= ${FLAG_MIN_DOWNVOTES} and d.downvotes > d.upvotes
      order by d.downvotes - d.upvotes desc`,
  );
}

/** Take a deal down (archived, audited) after users said it doesn't work and a moderator agreed. */
export async function archiveDeal(db: Db, adminId: string, dealId: string, note: string) {
  if (!note.trim()) throw new SubmissionRejected("Say why it's coming down.");
  return db.transaction(async (tx) => {
    const updated = await tx.query("update deals set status = 'archived' where id = $1 and status = 'published' returning id", [dealId]);
    if (!updated.length) throw new SubmissionRejected("Already taken down.", 409);
    await tx.query(
      `insert into audit_log (actor_id, actor_kind, table_name, record_id, action, old_values, new_values)
       values ($1, 'admin', 'deals', $2, 'archive', '{"status":"published"}', $3)`,
      [adminId, dealId, JSON.stringify({ status: "archived", note: note.trim() })],
    );
  });
}
