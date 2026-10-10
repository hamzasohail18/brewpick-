// Publisher (Section 7.3 step 6): writes an approved staged record to the live tables inside the
// caller's transaction, supersedes what it replaces, and leaves an audit_log trail.

import type { Db } from "@/lib/db/core";
import { findItemSize, livePrices } from "./match";
import { normName } from "./normalize";
import { TARGET_TABLE, type BeanRecord, type DealRecord, type NutritionRecord, type PlaceRecord, type PriceRecord, type StagedRecord } from "./records";
import { validateRecord } from "./validate";

export interface Reviewer {
  /** null for the pipeline itself (auto-approved re-confirmations). */
  id: string | null;
  kind: "admin" | "bot" | "owner" | "community";
}

export class PublishError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "PublishError";
  }
}

async function audit(
  tx: Db,
  who: Reviewer,
  table: string,
  recordId: string,
  action: string,
  oldValues: unknown,
  newValues: unknown,
  sourceId: string | null,
) {
  await tx.query(
    `insert into audit_log (actor_id, actor_kind, table_name, record_id, action, old_values, new_values, source_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [who.id, who.kind, table, recordId, action, oldValues === null ? null : JSON.stringify(oldValues), newValues === null ? null : JSON.stringify(newValues), sourceId],
  );
}

/** Re-confirmation: the live data is unchanged; record that someone looked again today. */
export async function applyReconfirm(tx: Db, who: Reviewer, table: string, targetId: string, sourceId: string | null) {
  if (!Object.values(TARGET_TABLE).includes(table)) throw new Error(`Unknown target table ${table}`);
  await tx.query(`update ${table} set last_verified_at = now() where id = $1`, [targetId]);
  await audit(tx, who, table, targetId, "reconfirm", null, { last_verified_at: "now" }, sourceId);
}

// ---------- prices ----------

async function applyPrice(tx: Db, who: Reviewer, r: PriceRecord, sourceId: string) {
  // Find or create the menu item and size this price belongs to.
  const items = await tx.query<{ id: string; display_name: string }>(
    "select id, display_name from menu_items where place_id = $1 and status <> 'archived'",
    [r.place_id],
  );
  let menuItemId = items.find((i) => normName(i.display_name) === normName(r.item.display_name))?.id;
  if (!menuItemId) {
    [{ id: menuItemId }] = await tx.query<{ id: string }>(
      `insert into menu_items (place_id, drink_type_id, display_name, temperature, has_milk, status)
       values ($1, (select id from drink_types where slug = $2), $3, coalesce($4::temperature,
               (select default_temperature from drink_types where slug = $2), 'hot'), $5, 'published')
       returning id`,
      [r.place_id, r.item.drink_type_slug, r.item.display_name, r.item.temperature, r.item.has_milk],
    );
    await audit(tx, who, "menu_items", menuItemId, "insert", null, r.item, sourceId);
  }

  const sizes = await tx.query<{ id: string; size_label: string; volume_ml: number | null; volume_is_assumed: boolean }>(
    "select id, size_label, volume_ml, volume_is_assumed from item_sizes where menu_item_id = $1",
    [menuItemId],
  );
  let size = sizes.find((s) => normName(s.size_label) === normName(r.size.size_label));
  if (!size) {
    [size] = await tx.query(
      "insert into item_sizes (menu_item_id, size_label, volume_ml, volume_is_assumed) values ($1, $2, $3, $4) returning *",
      [menuItemId, r.size.size_label, r.size.volume_ml, r.size.volume_is_assumed],
    );
  } else if (!r.size.volume_is_assumed && r.size.volume_ml && (size.volume_is_assumed || size.volume_ml !== r.size.volume_ml)) {
    // A stated volume replaces an assumed one (or a stale one).
    await tx.query("update item_sizes set volume_ml = $2, volume_is_assumed = false where id = $1", [size.id, r.size.volume_ml]);
  }

  // Supersede whatever is current for this size + channel *now* (not what was current at staging time).
  const [old] = await tx.query<{ id: string; price_pkr: number }>(
    `update item_prices set is_current = false, superseded_at = now()
      where item_size_id = $1 and channel = $2 and is_current
      returning id, price_pkr`,
    [size!.id, r.channel],
  );
  const [{ id: priceId }] = await tx.query<{ id: string }>(
    `insert into item_prices (item_size_id, channel, price_pkr, tax_inclusive, is_current, source_id, source_url,
                              proof_image_url, confidence, captured_at, last_verified_at)
     values ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, now()) returning id`,
    [size!.id, r.channel, r.price_pkr, r.tax_inclusive, sourceId, r.source_url, r.proof_image_url, r.confidence, r.captured_at],
  );
  await audit(tx, who, "item_prices", priceId, "publish", old ?? null, { price_pkr: r.price_pkr, channel: r.channel, supersedes: old?.id ?? null }, sourceId);
  return priceId;
}

/** An item the source no longer lists: archive the menu item (its prices stay for history). */
async function applyRemoval(tx: Db, who: Reviewer, priceId: string, sourceId: string) {
  const [row] = await tx.query<{ menu_item_id: string }>(
    `select s.menu_item_id from item_prices p join item_sizes s on s.id = p.item_size_id where p.id = $1`,
    [priceId],
  );
  if (!row) throw new PublishError(["The price this removal refers to no longer exists."]);
  await tx.query("update menu_items set status = 'archived' where id = $1", [row.menu_item_id]);
  await tx.query("update item_prices set is_current = false, superseded_at = now() where item_size_id in (select id from item_sizes where menu_item_id = $1) and is_current", [row.menu_item_id]);
  await audit(tx, who, "menu_items", row.menu_item_id, "archive", null, { reason: "removed from source menu" }, sourceId);
  return row.menu_item_id;
}

// ---------- places ----------

const PLACE_FIELDS = [
  "name", "branch_name", "type", "area_id", "address", "lat", "lng", "phone", "website_url", "instagram_handle",
  "osm_id", "google_place_id", "halal_certified", "has_wifi", "has_family_seating", "has_drive_thru",
] as const;

async function applyPlace(tx: Db, who: Reviewer, r: PlaceRecord, targetId: string | null, sourceId: string) {
  if (targetId) {
    // Only overwrite what the source actually states.
    const fields = PLACE_FIELDS.filter((f) => r[f] !== null && r[f] !== undefined);
    const [old] = await tx.query("select * from places where id = $1", [targetId]);
    await tx.query(
      `update places set ${fields.map((f, i) => `${f} = $${i + 2}`).join(", ")}, confidence = $${fields.length + 2},
              last_verified_at = now() where id = $1`,
      [targetId, ...fields.map((f) => r[f]), r.confidence],
    );
    await writeHours(tx, targetId, r);
    await audit(tx, who, "places", targetId, "update", old, { ...Object.fromEntries(fields.map((f) => [f, r[f]])), hours: r.hours }, sourceId);
    return targetId;
  }
  const slug = await uniquePlaceSlug(tx, r.branch_name ? `${r.name} ${r.branch_name}` : r.name);
  const [{ id }] = await tx.query<{ id: string }>(
    `insert into places (slug, ${PLACE_FIELDS.join(", ")}, status, source_id, confidence, last_verified_at)
     values ($1, ${PLACE_FIELDS.map((_, i) => `$${i + 2}`).join(", ")}, 'published', $${PLACE_FIELDS.length + 2}, $${PLACE_FIELDS.length + 3}, now())
     returning id`,
    [slug, ...PLACE_FIELDS.map((f) => r[f]), sourceId, r.confidence],
  );
  await writeHours(tx, id, r);
  await audit(tx, who, "places", id, "insert", null, r, sourceId);
  return id;
}

async function writeHours(tx: Db, placeId: string, r: PlaceRecord) {
  if (!r.hours) return; // source silent about hours: keep what we have
  await tx.query("delete from place_hours where place_id = $1", [placeId]);
  for (const h of r.hours) {
    await tx.query(
      "insert into place_hours (place_id, day_of_week, opens_at, closes_at, is_closed) values ($1, $2, $3, $4, $5)",
      [placeId, h.day_of_week, h.is_closed ? null : h.opens, h.is_closed ? null : h.closes, h.is_closed],
    );
  }
}

async function uniquePlaceSlug(tx: Db, name: string) {
  const base = normName(name).replace(/ /g, "-").slice(0, 60) || "place";
  const taken = new Set(
    (await tx.query<{ slug: string }>("select slug from places where slug = $1 or slug like $1 || '-%'", [base])).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ---------- nutrition ----------

async function applyNutrition(tx: Db, who: Reviewer, r: NutritionRecord, sourceId: string) {
  const size = await findItemSize(tx, r.place_id, r.item_display_name, r.size_label);
  if (!size) throw new PublishError([`"${r.item_display_name}" (${r.size_label}) isn't on this place's menu yet. Approve its price first.`]);
  const [milk] = r.milk_type_slug
    ? await tx.query<{ id: number }>("select id from milk_types where slug = $1", [r.milk_type_slug])
    : [{ id: null as number | null }];
  if (r.milk_type_slug && !milk) throw new PublishError([`Unknown milk type "${r.milk_type_slug}".`]);

  const [old] = await tx.query("delete from nutrition_info where item_size_id = $1 and milk_type_id is not distinct from $2 returning *", [
    size.item_size_id,
    milk.id,
  ]);
  const [{ id }] = await tx.query<{ id: string }>(
    `insert into nutrition_info (item_size_id, milk_type_id, calories_kcal, sugar_g, caffeine_mg, fat_g, protein_g, assumptions,
                                 source_id, source_url, confidence, captured_at, last_verified_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()) returning id`,
    [size.item_size_id, milk.id, r.calories_kcal, r.sugar_g, r.caffeine_mg, r.fat_g, r.protein_g, r.assumptions, sourceId, r.source_url, r.confidence, r.captured_at],
  );
  await audit(tx, who, "nutrition_info", id, "publish", old ?? null, r, sourceId);
  return id;
}

// ---------- deals ----------

async function applyDeal(tx: Db, who: Reviewer, r: DealRecord, targetId: string | null, sourceId: string) {
  const methods = r.payment_methods.length
    ? await tx.query<{ id: number; name: string }>("select id, name from payment_methods where lower(name) = any($1::text[])", [
        r.payment_methods.map((m) => m.toLowerCase()),
      ])
    : [];
  const missing = r.payment_methods.filter((m) => !methods.some((x) => x.name.toLowerCase() === m.toLowerCase()));
  if (missing.length) throw new PublishError([`Unknown payment method(s): ${missing.join(", ")}. Add them to payment_methods first.`]);

  let itemIds: string[] = [];
  if (r.item_names.length) {
    if (!r.place_id) throw new PublishError(["Item-specific deals must belong to a place."]);
    const items = await tx.query<{ id: string; display_name: string }>(
      "select id, display_name from menu_items where place_id = $1 and status <> 'archived'",
      [r.place_id],
    );
    const unknown = r.item_names.filter((n) => !items.some((i) => normName(i.display_name) === normName(n)));
    if (unknown.length) throw new PublishError([`Not on the menu: ${unknown.join(", ")}.`]);
    itemIds = items.filter((i) => r.item_names.some((n) => normName(n) === normName(i.display_name))).map((i) => i.id);
  }

  const values = [
    r.place_id, r.brand_id, r.title, r.deal_type, r.discount, r.discount_value, r.max_discount_pkr, r.min_spend_pkr,
    r.valid_from, r.valid_to, r.days_of_week, r.start_time, r.end_time, r.terms, itemIds.length === 0,
    sourceId, r.source_url, r.proof_image_url, r.confidence, r.captured_at,
  ];
  let id = targetId;
  let old: unknown = null;
  if (id) {
    [old] = await tx.query("select * from deals where id = $1", [id]);
    await tx.query(
      `update deals set place_id = $2, brand_id = $3, title = $4, deal_type = $5, discount = $6, discount_value = $7,
              max_discount_pkr = $8, min_spend_pkr = $9, valid_from = $10, valid_to = $11, days_of_week = $12,
              start_time = $13, end_time = $14, terms = $15, applies_to_all_items = $16, source_id = $17,
              source_url = $18, proof_image_url = $19, confidence = $20, captured_at = $21,
              status = 'published', last_verified_at = now()
        where id = $1`,
      [id, ...values],
    );
    await tx.query("delete from deal_payment_methods where deal_id = $1", [id]);
    await tx.query("delete from deal_items where deal_id = $1", [id]);
    await tx.query("delete from deal_conditions where deal_id = $1", [id]);
  } else {
    [{ id }] = await tx.query<{ id: string }>(
      `insert into deals (place_id, brand_id, title, deal_type, discount, discount_value, max_discount_pkr, min_spend_pkr,
                          valid_from, valid_to, days_of_week, start_time, end_time, terms, applies_to_all_items,
                          source_id, source_url, proof_image_url, confidence, captured_at, status, last_verified_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'published', now()) returning id`,
      values,
    );
  }
  for (const m of methods) await tx.query("insert into deal_payment_methods values ($1, $2)", [id, m.id]);
  for (const i of itemIds) await tx.query("insert into deal_items values ($1, $2)", [id, i]);
  for (const c of r.conditions) await tx.query("insert into deal_conditions (deal_id, condition_key) values ($1, $2)", [id, c]);
  await audit(tx, who, "deals", id!, targetId ? "update" : "insert", old, r, sourceId);
  return id!;
}

// ---------- beans ----------

async function applyBean(tx: Db, who: Reviewer, r: BeanRecord, targetId: string | null, sourceId: string) {
  let menuItemId: string | null = null;
  if (r.item_display_name) {
    const items = await tx.query<{ id: string; display_name: string }>(
      "select id, display_name from menu_items where place_id = $1 and status <> 'archived'",
      [r.place_id],
    );
    menuItemId = items.find((i) => normName(i.display_name) === normName(r.item_display_name!))?.id ?? null;
    if (!menuItemId) throw new PublishError([`"${r.item_display_name}" isn't on this place's menu.`]);
  }
  const values = [
    r.place_id, menuItemId, r.bean_kind, r.origin_country, r.origin_region, r.roaster, r.roast, r.arabica_pct,
    r.robusta_pct, r.tasting_notes, sourceId, r.source_url, r.confidence, r.captured_at,
  ];
  if (targetId) {
    const [old] = await tx.query("select * from bean_info where id = $1", [targetId]);
    await tx.query(
      `update bean_info set place_id = $2, menu_item_id = $3, kind = $4, origin_country = $5, origin_region = $6, roaster = $7,
              roast = $8, arabica_pct = $9, robusta_pct = $10, tasting_notes = $11, source_id = $12, source_url = $13,
              confidence = $14, captured_at = $15, last_verified_at = now()
        where id = $1`,
      [targetId, ...values],
    );
    await audit(tx, who, "bean_info", targetId, "update", old, r, sourceId);
    return targetId;
  }
  const [{ id }] = await tx.query<{ id: string }>(
    `insert into bean_info (place_id, menu_item_id, kind, origin_country, origin_region, roaster, roast, arabica_pct,
                            robusta_pct, tasting_notes, source_id, source_url, confidence, captured_at, last_verified_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now()) returning id`,
    values,
  );
  await audit(tx, who, "bean_info", id, "insert", null, r, sourceId);
  return id;
}

// ---------- review actions ----------

interface StagingRow {
  id: string;
  source_id: string;
  target_table: string;
  target_id: string | null;
  action: "create" | "update" | "delete" | "reconfirm";
  proposed: unknown;
  status: string;
}

async function lockPending(tx: Db, stagingId: string): Promise<StagingRow> {
  const [row] = await tx.query<StagingRow>("select * from staging_records where id = $1 for update", [stagingId]);
  if (!row) throw new PublishError(["Staged record not found."]);
  if (row.status !== "pending_review") throw new PublishError([`Already ${row.status.replace("_", " ")}.`]);
  return row;
}

/**
 * Approve a staged record (optionally with reviewer edits) and publish it. Runs in the caller's
 * transaction; throws PublishError with readable reasons if it can't be applied.
 */
export async function approveStaged(tx: Db, who: Reviewer, stagingId: string, edited?: unknown) {
  const row = await lockPending(tx, stagingId);
  let liveId: string;

  if (row.action === "delete") {
    liveId = await applyRemoval(tx, who, row.target_id!, row.source_id);
  } else if (row.action === "reconfirm" && edited === undefined) {
    await applyReconfirm(tx, who, row.target_table, row.target_id!, row.source_id);
    liveId = row.target_id!;
  } else {
    const v = validateRecord(edited ?? row.proposed);
    if (v.errors.length) throw new PublishError(v.errors);
    liveId = await applyRecord(tx, who, v.record!, row.target_id, row.source_id);
  }

  await tx.query(
    `update staging_records set status = 'published', reviewed_by = $2, reviewed_at = now(),
            proposed = coalesce($3::jsonb, proposed),
            review_note = case when $3::jsonb is null then review_note else 'Edited by reviewer before approval' end
      where id = $1`,
    [stagingId, who.id, edited === undefined ? null : JSON.stringify(edited)],
  );
  return liveId;
}

export async function applyRecord(tx: Db, who: Reviewer, r: StagedRecord, targetId: string | null, sourceId: string) {
  switch (r.kind) {
    case "item_price":
      return applyPrice(tx, who, r, sourceId);
    case "place":
      return applyPlace(tx, who, r, targetId, sourceId);
    case "nutrition":
      return applyNutrition(tx, who, r, sourceId);
    case "deal":
      return applyDeal(tx, who, r, targetId, sourceId);
    case "bean":
      return applyBean(tx, who, r, targetId, sourceId);
  }
}

export async function rejectStaged(tx: Db, who: Reviewer, stagingId: string, note: string) {
  await lockPending(tx, stagingId);
  if (!note.trim()) throw new PublishError(["Say why it's rejected, so the source can be fixed."]);
  await tx.query(
    "update staging_records set status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3 where id = $1",
    [stagingId, who.id, note.trim()],
  );
}

export { livePrices };
