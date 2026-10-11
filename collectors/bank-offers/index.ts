// Bank offer collector (source kind bank_offer_page): reads the offers page at base_url, keeps offers that
// name a cafe in the directory, and stages them as bank_card deals for the bank's cards. Every bank
// source starts as unknown_review_required; until an admin confirms automation is allowed, offers are
// entered by hand at /admin/deals/new with the offer page as the source URL (the manual fallback).

import { SERVICE, withActor } from "@/lib/db/core";
import { normName, karachiDate } from "@/lib/pipeline/normalize";
import { stageRecords } from "@/lib/pipeline/stage";
import type { CollectorContext, CollectorResult } from "../lib/runner";
import { parseBankOffers, type Merchant, type ParsedOffer } from "./parse";

/** The payment method a bank source stands for: the one whose name appears in the source's name. */
export function bankPaymentMethod(sourceName: string, methods: { name: string; kind: string }[]): string | null {
  const n = ` ${normName(sourceName)} `;
  const hits = methods.filter((m) => m.kind === "bank_card" && n.includes(` ${normName(m.name)} `));
  return hits.sort((a, b) => b.name.length - a.name.length)[0]?.name ?? null;
}

export function offerToDeal(o: ParsedOffer, bank: string, sourceUrl: string, confidence: string, capturedAt: string, today: string) {
  const discount = o.percent !== null ? `${o.percent}% off` : `Rs ${o.flatPkr} off`;
  return {
    kind: "deal",
    place_id: o.merchant.kind === "place" ? o.merchant.id : null,
    brand_id: o.merchant.kind === "brand" ? o.merchant.id : null,
    title: `${discount} at ${o.merchant.name} with ${bank} cards`,
    deal_type: "bank_card",
    discount: o.percent !== null ? "percent" : "flat_pkr",
    discount_value: o.percent ?? o.flatPkr,
    max_discount_pkr: o.capPkr,
    min_spend_pkr: o.minSpendPkr,
    // The page gave no start date: the offer was live when we read it, so that's the earliest date we know.
    valid_from: o.validFrom ?? today,
    valid_to: o.validTo,
    days_of_week: o.days,
    terms: o.text.slice(0, 600),
    payment_methods: [bank],
    item_names: [],
    conditions: o.validFrom ? [] : ["Start date not stated on the bank's page; shown from the day it was collected."],
    source_url: sourceUrl,
    proof_image_url: null,
    confidence,
    captured_at: capturedAt,
  };
}

export async function collectBankOffers(ctx: CollectorContext): Promise<CollectorResult> {
  const page = await ctx.fetch(ctx.policy.baseUrl);
  if (page.status !== 200) throw new Error(`The offers page returned ${page.status}.`);
  const snapshot = await ctx.snapshots.save(ctx.runId, "offers.html", page.body);
  const today = karachiDate();

  const result = await withActor(ctx.db, SERVICE, async (tx) => {
    const methods = await tx.query<{ name: string; kind: string }>("select name, kind::text from payment_methods");
    const bank = bankPaymentMethod(ctx.source.name, methods);
    if (!bank) throw new Error(`No bank card payment method matches the source name "${ctx.source.name}". Rename the source to include the bank's name.`);

    // Real cafes only: sample places are fictional and must never pick up a real bank's offer.
    const merchants = await tx.query<Merchant>(
      `select 'brand' as kind, id, name from brands where not is_sample
       union all
       select 'place', id, name from places where not is_sample and status = 'published' and brand_id is null`,
    );
    const { offers } = parseBankOffers(page.body, merchants, today);
    const complete = offers.filter((o) => !o.missing);
    const incomplete = offers.filter((o) => o.missing);
    ctx.log(`${offers.length} offers name a cafe in the directory; ${incomplete.length} need manual entry`);
    for (const o of incomplete) ctx.log(`  manual entry needed (${o.missing}): ${o.merchant.name}: ${o.text.slice(0, 120)}`);

    const capturedAt = new Date().toISOString();
    const summary = await stageRecords(tx, {
      sourceId: ctx.source.id,
      runId: ctx.runId,
      records: complete.map((o) => offerToDeal(o, bank, page.url, ctx.source.default_confidence, capturedAt, today)),
      evidenceUrl: page.url,
      extraMessages: [
        "Read from the bank's offer page: check the discount, cap, dates and days against the page.",
        ...(incomplete.length
          ? [`${incomplete.length} other offer(s) on the page lacked a stated end date or discount; add them by hand if needed.`]
          : []),
      ],
    });
    return { offers, incomplete, summary };
  });

  ctx.log(`staged ${result.summary.staged}, re-confirmed ${result.summary.reconfirmed}, rejected ${result.summary.rejected}`);
  return {
    found: result.offers.length,
    staged: result.summary.staged,
    partial: result.incomplete.length > 0 || result.summary.rejected > 0,
    rawSnapshotUrl: snapshot,
  };
}
