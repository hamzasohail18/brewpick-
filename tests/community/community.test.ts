import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ANON, SERVICE, pgliteDb, withActor, type Actor, type Db } from "@/lib/db/core";
import { createSubmission, DAILY_LIMIT, mySubmissions, SubmissionPayload, SubmissionRejected, syncSubmissionForStaged } from "@/lib/community/submissions";
import { archiveDeal, ClaimInput, confirmMenu, createClaim, createReport, decideClaim, flaggedDeals, moderationCounts, ReportInput, resolveReport, resolveSubmission, voteOnDeal } from "@/lib/community/actions";
import { approveStaged, rejectStaged } from "@/lib/pipeline/publish";
import { freshDb } from "../db/harness";

const user = (n: number): Actor & { kind: "user" } => ({ kind: "user", userId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, isAdmin: false });
const ALICE = user(1);
const ADMIN = { id: "00000000-0000-4000-8000-00000000ad01", kind: "admin" as const };
const PROOF = "https://brewpick.example/uploads/2026/10/proof.jpg";

let pg: PGlite;
let db: Db;
let kite: string;
const as = <T>(actor: Actor, fn: (tx: Db) => Promise<T>) => withActor(db, actor, fn);
const service = <T>(fn: (tx: Db) => Promise<T>) => withActor(db, SERVICE, fn);

beforeAll(async () => {
  pg = await freshDb({ sample: true });
  db = pgliteDb(pg);
  [{ id: kite }] = await db.query<{ id: string }>("select id from places where slug = 'kite-and-cup'");
});

async function latteRegular(placeId = kite) {
  const [r] = await db.query<{ size_id: string; price_pkr: number; price_id: string }>(
    `select s.id as size_id, pr.price_pkr, pr.id as price_id from item_sizes s join menu_items mi on mi.id = s.menu_item_id
       join item_prices pr on pr.item_size_id = s.id and pr.is_current
      where mi.place_id = $1 and mi.display_name = 'Cafe Latte' and s.size_label = 'Regular'`,
    [placeId],
  );
  return r;
}

describe("community submissions", () => {
  test("a price correction becomes a staged record with the photo as evidence; status follows the review", async () => {
    const latte = await latteRegular();
    const payload = SubmissionPayload.parse({ type: "price_correction", item_size_id: latte.size_id, price_pkr: latte.price_pkr + 60 });
    const res = await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload, note: "New menu board", proofUrl: PROOF }));
    expect(res).toMatchObject({ asOwner: false, status: "pending_review", staged: { staged: 1 } });

    const [staged] = await db.query<Record<string, unknown>>("select * from staging_records where submission_id = $1", [res.id]);
    expect(staged).toMatchObject({ action: "update", evidence_url: PROOF, status: "pending_review" });
    expect(staged.flags).toContain("community");
    expect((staged.messages as string[]).join(" ")).toContain("Note from the sender: New menu board");
    expect((staged.proposed as { confidence: string }).confidence).toBe("community_reported");
    // The sender didn't say whether tax is included: the known value is kept, not erased.
    expect((staged.proposed as { tax_inclusive: boolean | null }).tax_inclusive).toBe(true);
    expect(staged.diff).not.toHaveProperty("tax_inclusive");

    await service((tx) => approveStaged(tx, ADMIN, staged.id as string).then(() => syncSubmissionForStaged(tx, staged.id as string)));
    expect((await latteRegular()).price_pkr).toBe(latte.price_pkr + 60);
    const mine = await as(ALICE, (tx) => mySubmissions(tx, ALICE.userId));
    expect(mine[0]).toMatchObject({ id: res.id, type: "price_correction", status: "published", placeSlug: "kite-and-cup" });
  });

  test("rejected in review: the submission shows rejected with the reviewer's note", async () => {
    const payload = SubmissionPayload.parse({ type: "new_item", display_name: "Pistachio Latte", price_pkr: 990 });
    const res = await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload, note: null, proofUrl: PROOF }));
    const [staged] = await db.query<{ id: string; flags: string[] }>("select id, flags from staging_records where submission_id = $1", [res.id]);
    expect(staged.flags).toContain("new_item");
    await service((tx) => rejectStaged(tx, ADMIN, staged.id, "Not on the menu in the photo").then(() => syncSubmissionForStaged(tx, staged.id)));
    const [sub] = await db.query<{ status: string; review_note: string }>("select status, review_note from submissions where id = $1", [res.id]);
    expect(sub).toEqual({ status: "rejected", review_note: "Not on the menu in the photo" });
  });

  test("the same price as now is an instant re-confirmation (published, nothing to review)", async () => {
    const latte = await latteRegular();
    const payload = SubmissionPayload.parse({ type: "price_correction", item_size_id: latte.size_id, price_pkr: latte.price_pkr });
    const res = await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload, note: null, proofUrl: PROOF }));
    expect(res).toMatchObject({ status: "published", staged: { reconfirmed: 1, staged: 0 } });
  });

  test("new deal and hours corrections are staged as deal / place records", async () => {
    const deal = SubmissionPayload.parse({
      type: "new_deal", title: "10% off with Easypaisa", deal_type: "other", discount: "percent", discount_value: 10,
      valid_to: "2026-12-31", payment_methods: ["Easypaisa"],
    });
    const d = await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload: deal, note: null, proofUrl: PROOF }));
    const [ds] = await db.query<{ target_table: string; action: string }>("select target_table, action from staging_records where submission_id = $1", [d.id]);
    expect(ds).toEqual({ target_table: "deals", action: "create" });

    const hours = SubmissionPayload.parse({
      type: "hours_correction",
      hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day_of_week: day, opens: "09:00", closes: "23:00", is_closed: false })),
    });
    const h = await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload: hours, note: null, proofUrl: PROOF }));
    const [hs] = await db.query<{ target_table: string; diff: Record<string, unknown>; action: string; status: string; messages: string[] }>(
      "select target_table, diff, action, status, messages from staging_records where submission_id = $1",
      [h.id],
    );
    expect(hs, JSON.stringify(hs.messages)).toMatchObject({ target_table: "places", action: "update", status: "pending_review" });
    expect(Object.keys(hs.diff)).toEqual(["hours"]); // only the hours differ from the live place
  });

  test("proof is required for price/menu/deal changes; free text goes to moderation, not review", async () => {
    const latte = await latteRegular();
    await expect(
      service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload: SubmissionPayload.parse({ type: "price_correction", item_size_id: latte.size_id, price_pkr: 700 }), note: null, proofUrl: null })),
    ).rejects.toThrow(SubmissionRejected);
    const other = await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload: SubmissionPayload.parse({ type: "other", message: "They now have a rooftop" }), note: null, proofUrl: null }));
    expect(other.staged).toBeNull();
    expect((await service((tx) => moderationCounts(tx))).submissions).toBe(1);
    await service((tx) => resolveSubmission(tx, ADMIN.id, other.id, true, "Thanks, noted"));
    expect((await service((tx) => moderationCounts(tx))).submissions).toBe(0);
  });

  test("a size from another place is refused", async () => {
    const [jasmine] = await db.query<{ id: string }>("select id from places where slug = 'jasmine-beans'");
    const other = await latteRegular(jasmine.id);
    await expect(
      service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload: SubmissionPayload.parse({ type: "price_correction", item_size_id: other.size_id, price_pkr: 700 }), note: null, proofUrl: PROOF })),
    ).rejects.toThrow("That drink isn't on this place's menu.");
  });

  test("daily limit across submissions, reports and claims", async () => {
    const spammer = user(99);
    const msg = SubmissionPayload.parse({ type: "other", message: "spam spam spam" });
    for (let i = 0; i < DAILY_LIMIT; i++) await service((tx) => createSubmission(tx, { userId: spammer.userId, placeId: kite, payload: msg, note: null, proofUrl: null }));
    await expect(service((tx) => createSubmission(tx, { userId: spammer.userId, placeId: kite, payload: msg, note: null, proofUrl: null }))).rejects.toMatchObject({ status: 429 });
    await expect(as(spammer, (tx) => createReport(tx, spammer.userId, ReportInput.parse({ target_table: "places", target_id: kite, reason: "other" })))).rejects.toMatchObject({ status: 429 });
  });
});

describe("deal votes", () => {
  test("vote, change, take back; tallies are public, individual votes private; flagged at 3+ net down", async () => {
    const [deal] = await db.query<{ id: string }>("select id from deals where title = 'Student 10% off'");
    expect(await as(user(10), (tx) => voteOnDeal(tx, user(10).userId, deal.id, true))).toEqual({ upvotes: 1, downvotes: 0 });
    expect(await as(user(10), (tx) => voteOnDeal(tx, user(10).userId, deal.id, false))).toEqual({ upvotes: 0, downvotes: 1 });
    for (const n of [11, 12]) await as(user(n), (tx) => voteOnDeal(tx, user(n).userId, deal.id, false));
    expect(await as(ANON, (tx) => tx.query("select upvotes, downvotes from deals where id = $1", [deal.id]))).toEqual([{ upvotes: 0, downvotes: 3 }]);
    expect(await as(user(11), (tx) => tx.query("select user_id from deal_votes"))).toEqual([{ user_id: user(11).userId }]);
    expect((await service((tx) => flaggedDeals(tx))).map((d) => d.title)).toEqual(["Student 10% off"]);
    expect(await as(user(12), (tx) => voteOnDeal(tx, user(12).userId, deal.id, null))).toEqual({ upvotes: 0, downvotes: 2 });
    await as(user(12), (tx) => voteOnDeal(tx, user(12).userId, deal.id, false));

    await service((tx) => archiveDeal(tx, ADMIN.id, deal.id, "Cafe confirmed it ended"));
    expect(await as(ANON, (tx) => tx.query("select 1 from deals where id = $1", [deal.id]))).toEqual([]);
    await expect(as(user(13), (tx) => voteOnDeal(tx, user(13).userId, deal.id, true))).rejects.toMatchObject({ status: 404 });
  });
});

describe("reports", () => {
  test("filed as the user, listed for moderators, resolved once", async () => {
    const id = await as(ALICE, (tx) => createReport(tx, ALICE.userId, ReportInput.parse({ target_table: "places", target_id: kite, reason: "wrong_hours", details: "Opens at 9 now" })));
    expect((await service((tx) => moderationCounts(tx))).reports).toBe(1);
    expect(await as(user(2), (tx) => tx.query("select * from reports"))).toEqual([]);
    await service((tx) => resolveReport(tx, ADMIN.id, id, "resolved", "Hours updated"));
    await expect(service((tx) => resolveReport(tx, ADMIN.id, id, "dismissed", null))).rejects.toMatchObject({ status: 409 });
  });
});

describe("owner claims and the owner portal", () => {
  const OWNER = user(50);
  test("claim -> approve -> owner updates are verified; confirm menu upgrades every price", async () => {
    await expect(as(OWNER, (tx) => createClaim(tx, OWNER.userId, kite, ClaimInput.parse({ verification_method: "document", contact_name: "Sara" }), null))).rejects.toThrow(/document/);
    const claimId = await as(OWNER, (tx) => createClaim(tx, OWNER.userId, kite, ClaimInput.parse({ verification_method: "phone_call", contact_name: "Sara", contact_phone: "+92 300 0000000" }), null));
    await expect(as(OWNER, (tx) => createClaim(tx, OWNER.userId, kite, ClaimInput.parse({ verification_method: "phone_call", contact_name: "Sara", contact_phone: "1" }), null))).rejects.toMatchObject({ status: 409 });

    // Not an owner yet: confirming the menu is refused.
    await expect(service((tx) => confirmMenu(tx, OWNER.userId, kite))).rejects.toMatchObject({ status: 403 });
    await service((tx) => decideClaim(tx, ADMIN.id, claimId, true, null));
    expect(await db.query("select user_id from place_owners where place_id = $1", [kite])).toEqual([{ user_id: OWNER.userId }]);

    // Who owns it is private: the public sees only "claimed"; the owner sees their own row; others nothing.
    expect(await as(ANON, (tx) => tx.query("select is_claimed from places where id = $1", [kite]))).toEqual([{ is_claimed: true }]);
    await expect(as(ANON, (tx) => tx.query("select * from place_owners"))).rejects.toThrow(/permission denied/);
    expect(await as(OWNER, (tx) => tx.query("select place_id from place_owners"))).toEqual([{ place_id: kite }]);
    expect(await as(user(52), (tx) => tx.query("select place_id from place_owners"))).toEqual([]);

    // A second person's claim can't take the place over.
    const other = user(51);
    const c2 = await as(other, (tx) => createClaim(tx, other.userId, kite, ClaimInput.parse({ verification_method: "business_email", contact_name: "Xavier", contact_email: "x@example.com" }), null));
    await expect(service((tx) => decideClaim(tx, ADMIN.id, c2, true, null))).rejects.toMatchObject({ status: 409 });

    // Owner's price change: staged for review as verified, flagged as an owner update.
    const latte = await latteRegular();
    const res = await service((tx) => createSubmission(tx, { userId: OWNER.userId, placeId: kite, payload: SubmissionPayload.parse({ type: "price_correction", item_size_id: latte.size_id, price_pkr: latte.price_pkr + 20 }), note: null, proofUrl: PROOF }));
    expect(res.asOwner).toBe(true);
    const [st] = await db.query<{ flags: string[]; proposed: { confidence: string }; source: string }>(
      "select sr.flags, sr.proposed, s.slug as source from staging_records sr join sources s on s.id = sr.source_id where sr.submission_id = $1",
      [res.id],
    );
    expect(st).toMatchObject({ source: "owner-portal", proposed: { confidence: "verified" } });
    expect(st.flags).toContain("owner_update");

    // "Everything is still right": all current prices re-confirmed and upgraded to verified, with an audit trail.
    const summary = await service((tx) => confirmMenu(tx, OWNER.userId, kite));
    expect(summary.staged).toBe(0);
    expect(summary.reconfirmed).toBeGreaterThan(10);
    const conf = await db.query<{ confidence: string }>(
      `select distinct pr.confidence from item_prices pr join item_sizes s on s.id = pr.item_size_id join menu_items mi on mi.id = s.menu_item_id
        where mi.place_id = $1 and pr.is_current`,
      [kite],
    );
    expect(conf).toEqual([{ confidence: "verified" }]);
    const [audit] = await db.query<{ actor_kind: string; old_values: unknown; new_values: { confidence: string } }>(
      "select actor_kind, old_values, new_values from audit_log where action = 'reconfirm' and actor_kind = 'owner' order by id desc limit 1",
    );
    expect(audit.new_values.confidence).toBe("verified");
  });

  test("a weaker re-confirmation never downgrades confidence", async () => {
    const latte = await latteRegular();
    await service((tx) => createSubmission(tx, { userId: ALICE.userId, placeId: kite, payload: SubmissionPayload.parse({ type: "price_correction", item_size_id: latte.size_id, price_pkr: latte.price_pkr }), note: null, proofUrl: PROOF }));
    expect(await db.query("select confidence from item_prices where id = $1", [latte.price_id])).toEqual([{ confidence: "verified" }]);
  });
});
