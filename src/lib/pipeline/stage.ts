// Entry point for everything that proposes data: collectors, CSV import, (later) submissions.
// validate -> match live row -> diff -> staging_records. Exact re-confirmations are applied at once.

import type { Db } from "@/lib/db/core";
import { diffRecord, type DiffFlag } from "./diff";
import { findCurrent, livePrices, priceKey } from "./match";
import { applyReconfirm, type Reviewer } from "./publish";
import { TARGET_TABLE, type StagedRecord } from "./records";
import { validateRecord, type Flag } from "./validate";

export interface StageOptions {
  sourceId: string;
  runId?: string | null;
  records: unknown[];
  /** Screenshot / page that backs the whole batch, used when a record has no proof of its own. */
  evidenceUrl?: string | null;
  /**
   * Set when the batch is a complete menu for a place + channel; live items missing from it are
   * staged as removals (flag removed_item). Never inferred: partial scrapes must not delete items.
   */
  completeMenus?: { place_id: string; channel: "dine_in" | "takeaway" | "delivery" }[];
  /** Who auto-approves re-confirmations. */
  actor?: Reviewer;
  /** Added to every record that goes to review (e.g. "geotag_missing" for a field capture). */
  extraFlags?: string[];
  /** Notes for the reviewer, shown on every record from this batch. */
  extraMessages?: string[];
  today?: string;
}

export interface StageSummary {
  staged: number;
  rejected: number;
  reconfirmed: number;
  superseded: number;
  removals: number;
}

export async function stageRecords(db: Db, opts: StageOptions): Promise<StageSummary> {
  const actor = opts.actor ?? { id: null, kind: "bot" };
  const summary: StageSummary = { staged: 0, rejected: 0, reconfirmed: 0, superseded: 0, removals: 0 };

  return db.transaction(async (tx) => {
    const insert = (row: {
      target_table: string;
      target_id: string | null;
      action: string;
      proposed: unknown;
      current: unknown;
      diff: unknown;
      flags: string[];
      messages: string[];
      evidence_url: string | null;
      status: string;
      match_key: string | null;
      review_note?: string | null;
    }) =>
      tx.query(
        `insert into staging_records (source_run_id, source_id, target_table, target_id, action, proposed, current, diff,
                                      flags, messages, evidence_url, status, match_key, review_note, reviewed_at)
         values ($1, $2, $3, $4, $5::staging_action, $6, $7, $8, $9, $10, $11, $12::record_status, $13, $14,
                 case when $12::record_status = 'pending_review' then null else now() end)`,
        [
          opts.runId ?? null,
          opts.sourceId,
          row.target_table,
          row.target_id,
          row.action,
          JSON.stringify(row.proposed),
          row.current === null ? null : JSON.stringify(row.current),
          row.diff === null ? null : JSON.stringify(row.diff),
          row.flags,
          row.messages,
          row.evidence_url,
          row.status,
          row.match_key,
          row.review_note ?? null,
        ],
      );

    const seenPriceKeys = new Set<string>();

    for (const input of opts.records) {
      const v = validateRecord(input, { today: opts.today });
      const kind = (input as { kind?: string })?.kind;
      const evidence = v.record?.proof_image_url ?? v.record?.source_url ?? opts.evidenceUrl ?? null;

      if (v.errors.length) {
        // Kept (not dropped) so admins can see what a source got wrong.
        await insert({
          target_table: TARGET_TABLE[kind as StagedRecord["kind"]] ?? "unknown",
          target_id: null,
          action: "create",
          proposed: input ?? {},
          current: null,
          diff: null,
          flags: ["validation_error", ...v.flags],
          messages: v.errors,
          evidence_url: evidence,
          status: "rejected",
          match_key: null,
          review_note: "Rejected by validator",
        });
        summary.rejected++;
        continue;
      }

      const r = v.record!;
      const match = await findCurrent(tx, r);
      if (r.kind === "item_price") seenPriceKeys.add(match.matchKey);
      const d = diffRecord(r.kind, match.current, r);
      const table = TARGET_TABLE[r.kind];

      // Nothing changed, so there's nothing new to review: any warnings were seen when this data was approved.
      if (d.action === "reconfirm") {
        await applyReconfirm(tx, actor, table, match.targetId!, opts.sourceId);
        await insert({
          target_table: table,
          target_id: match.targetId,
          action: "reconfirm",
          proposed: r,
          current: match.current,
          diff: {},
          flags: [],
          messages: [],
          evidence_url: evidence,
          status: "published",
          match_key: match.matchKey,
          review_note: "Auto-approved: exact re-confirmation",
        });
        summary.reconfirmed++;
        continue;
      }

      // A newer proposal for the same thing replaces one still waiting for review.
      const superseded = await tx.query(
        `update staging_records set status = 'archived', review_note = 'Superseded by a newer proposal'
          where match_key = $1 and status = 'pending_review' returning id`,
        [match.matchKey],
      );
      summary.superseded += superseded.length;

      await insert({
        target_table: table,
        target_id: match.targetId,
        action: d.action,
        proposed: r,
        current: match.current,
        diff: d.diff,
        flags: [...v.flags, ...d.flags, ...(opts.extraFlags ?? [])] as (Flag | DiffFlag)[],
        messages: [...v.warnings, ...(opts.extraMessages ?? [])],
        evidence_url: evidence,
        status: "pending_review",
        match_key: match.matchKey,
      });
      summary.staged++;
    }

    for (const menu of opts.completeMenus ?? []) {
      for (const live of await livePrices(tx, menu.place_id, menu.channel)) {
        const key = priceKey(menu.place_id, live.display_name, live.size_label, menu.channel);
        if (seenPriceKeys.has(key)) continue;
        const pending = await tx.query("select 1 from staging_records where match_key = $1 and status = 'pending_review' and action = 'delete'", [key]);
        if (pending.length) continue;
        await insert({
          target_table: "item_prices",
          target_id: live.price_id,
          action: "delete",
          proposed: { kind: "item_price_removal", place_id: menu.place_id, display_name: live.display_name, size_label: live.size_label, channel: menu.channel },
          current: { price_pkr: live.price_pkr, display_name: live.display_name, size_label: live.size_label },
          diff: null,
          flags: ["removed_item", ...(opts.extraFlags ?? [])],
          messages: [`"${live.display_name}" (${live.size_label}) is no longer on the source's menu.`, ...(opts.extraMessages ?? [])],
          evidence_url: opts.evidenceUrl ?? null,
          status: "pending_review",
          match_key: key,
        });
        summary.removals++;
      }
    }

    if (opts.runId) {
      await tx.query("update source_runs set records_staged = coalesce(records_staged, 0) + $2 where id = $1", [
        opts.runId,
        summary.staged + summary.removals,
      ]);
    }
    return summary;
  });
}
