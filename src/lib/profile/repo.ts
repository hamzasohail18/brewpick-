// The signed-in user's own rows: profile, favourites, saved cards. Always run as that user
// (dbAs(actor, ...)) so RLS (own_row / own_rows policies) keeps every user to their own data.

import { z } from "zod";
import type { Db } from "@/lib/db/core";

export const ProfileUpdate = z.object({
  display_name: z.string().trim().max(60).nullable().optional(),
  language: z.enum(["en", "ur"]).optional(),
  default_area_id: z.number().int().positive().nullable().optional(),
  default_budget_pkr: z.number().int().positive().max(5000).nullable().optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export interface Profile {
  displayName: string | null;
  language: "en" | "ur";
  defaultAreaId: number | null;
  defaultBudgetPkr: number | null;
}

export interface FavoritePlace {
  placeId: string;
  slug: string;
  name: string;
  branchName: string | null;
  areaName: string | null;
  isSample: boolean;
}

export interface Me {
  profile: Profile;
  favorites: FavoritePlace[];
  cards: number[];
}

/** Profile rows are created lazily, on the first request from a signed-in user. */
export async function ensureProfile(db: Db, userId: string): Promise<void> {
  await db.query("insert into user_profiles (id) values ($1) on conflict (id) do nothing", [userId]);
}

export async function getMe(db: Db, userId: string): Promise<Me> {
  await ensureProfile(db, userId);
  const [p] = await db.query<{ display_name: string | null; language: "en" | "ur"; default_area_id: number | null; default_budget_pkr: number | null }>(
    "select display_name, language, default_area_id, default_budget_pkr from user_profiles where id = $1",
    [userId],
  );
  const favorites = await db.query<FavoritePlace>(
    `select p.id as "placeId", p.slug, p.name, p.branch_name as "branchName", a.name as "areaName", p.is_sample as "isSample"
       from favorites f join places p on p.id = f.place_id left join areas a on a.id = p.area_id
      where f.user_id = $1 and p.status = 'published'
      order by f.created_at desc`,
    [userId],
  );
  const cards = (await db.query<{ id: number }>("select payment_method_id as id from user_payment_methods where user_id = $1 order by 1", [userId])).map((r) => r.id);
  return {
    profile: { displayName: p.display_name, language: p.language, defaultAreaId: p.default_area_id, defaultBudgetPkr: p.default_budget_pkr },
    favorites,
    cards,
  };
}

export async function updateProfile(db: Db, userId: string, patch: ProfileUpdate): Promise<void> {
  await ensureProfile(db, userId);
  const sets: string[] = [];
  const params: unknown[] = [userId];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    params.push(k === "display_name" && typeof v === "string" ? v.trim() || null : v); // blank name = no name
    sets.push(`${k} = $${params.length}`);
  }
  if (sets.length) await db.query(`update user_profiles set ${sets.join(", ")} where id = $1`, params);
}

/** Add favourites (only published places; unknown ids are ignored). Used for one-off merges from the phone too. */
export async function addFavorites(db: Db, userId: string, placeIds: string[]): Promise<void> {
  if (!placeIds.length) return;
  await ensureProfile(db, userId);
  await db.query(
    `insert into favorites (user_id, place_id)
     select $1, p.id from places p where p.id = any ($2::uuid[]) and p.status = 'published'
     on conflict do nothing`,
    [userId, placeIds],
  );
}

export async function removeFavorite(db: Db, userId: string, placeId: string): Promise<void> {
  await db.query("delete from favorites where user_id = $1 and place_id = $2", [userId, placeId]);
}

/** Replace the saved cards on the account (names only: payment_methods ids). Empty = remove them all. */
export async function setCards(db: Db, userId: string, ids: number[]): Promise<number[]> {
  await ensureProfile(db, userId);
  await db.query("delete from user_payment_methods where user_id = $1", [userId]);
  if (ids.length) {
    await db.query(
      `insert into user_payment_methods (user_id, payment_method_id)
       select $1, pm.id from payment_methods pm where pm.id = any ($2::int[]) on conflict do nothing`,
      [userId, ids],
    );
  }
  return (await db.query<{ id: number }>("select payment_method_id as id from user_payment_methods where user_id = $1 order by 1", [userId])).map((r) => r.id);
}
