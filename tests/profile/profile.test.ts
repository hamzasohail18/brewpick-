import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ANON, pgliteDb, withActor, type Actor, type Db } from "@/lib/db/core";
import { addFavorites, getMe, removeFavorite, setCards, updateProfile } from "@/lib/profile/repo";
import { safeReturnPath } from "@/lib/auth/next";
import { freshDb } from "../db/harness";

const ALICE: Actor = { kind: "user", userId: "00000000-0000-4000-8000-0000000a11ce", isAdmin: false };
const BOB: Actor = { kind: "user", userId: "00000000-0000-4000-8000-000000000b0b", isAdmin: false };

let pg: PGlite;
let db: Db;
let placeIds: Record<string, string>;
const as = <T>(actor: Actor, fn: (tx: Db) => Promise<T>) => withActor(db, actor, fn);
const id = (a: Actor) => (a.kind === "user" ? a.userId : "");

beforeAll(async () => {
  pg = await freshDb({ sample: true });
  db = pgliteDb(pg);
  placeIds = Object.fromEntries((await db.query<{ slug: string; id: string }>("select slug, id from places")).map((r) => [r.slug, r.id]));
});

describe("profile, favourites and saved cards", () => {
  test("profile is created on first use with sensible defaults, and can be updated", async () => {
    const me = await as(ALICE, (tx) => getMe(tx, id(ALICE)));
    expect(me).toEqual({ profile: { displayName: null, language: "en", defaultAreaId: null, defaultBudgetPkr: null }, favorites: [], cards: [] });
    await as(ALICE, (tx) => updateProfile(tx, id(ALICE), { display_name: "  ", default_budget_pkr: 800, default_area_id: 2 }));
    expect((await as(ALICE, (tx) => getMe(tx, id(ALICE)))).profile).toEqual({ displayName: null, language: "en", defaultAreaId: 2, defaultBudgetPkr: 800 });
  });

  test("favourites: add (idempotent, published places only), list newest first, remove", async () => {
    await pg.exec("insert into places (slug, name, type, lat, lng, status) values ('draft-spot', 'Draft Spot', 'chain', 31.5, 74.3, 'draft')");
    const [draft] = await db.query<{ id: string }>("select id from places where slug = 'draft-spot'");
    await as(ALICE, (tx) => addFavorites(tx, id(ALICE), [placeIds["kite-and-cup"]]));
    await as(ALICE, (tx) => addFavorites(tx, id(ALICE), [placeIds["jasmine-beans"], placeIds["kite-and-cup"], draft.id, "00000000-0000-4000-8000-000000000000"]));
    const favs = (await as(ALICE, (tx) => getMe(tx, id(ALICE)))).favorites;
    expect(favs.map((f) => f.slug).sort()).toEqual(["jasmine-beans", "kite-and-cup"]);
    expect(favs.find((f) => f.slug === "kite-and-cup")).toMatchObject({ name: "Kite & Cup", areaName: "Model Town", isSample: true });
    await as(ALICE, (tx) => removeFavorite(tx, id(ALICE), placeIds["kite-and-cup"]));
    expect((await as(ALICE, (tx) => getMe(tx, id(ALICE)))).favorites.map((f) => f.slug)).toEqual(["jasmine-beans"]);
  });

  test("saved cards on the account: replace, ignore unknown ids, clear", async () => {
    const pm = Object.fromEntries((await db.query<{ name: string; id: number }>("select name, id from payment_methods")).map((r) => [r.name, r.id]));
    expect(await as(ALICE, (tx) => setCards(tx, id(ALICE), [pm.HBL, pm.Foodpanda, 99999]))).toEqual([pm.HBL, pm.Foodpanda].sort((a, b) => a - b));
    expect(await as(ALICE, (tx) => setCards(tx, id(ALICE), [pm.UBL]))).toEqual([pm.UBL]);
    expect(await as(ALICE, (tx) => setCards(tx, id(ALICE), []))).toEqual([]);
    await as(ALICE, (tx) => setCards(tx, id(ALICE), [pm.HBL]));
  });

  test("RLS: users only ever see and change their own rows", async () => {
    // Bob can't read Alice's favourites, cards or profile even by asking for her id…
    const peek = await as(BOB, (tx) => getMe(tx, id(ALICE)).catch((e: Error) => e));
    expect(peek).toBeInstanceOf(Error); // creating a profile row for someone else is refused
    const bobSees = await as(BOB, (tx) => tx.query("select * from favorites union all select user_id, null::uuid, null::timestamptz from user_payment_methods"));
    expect(bobSees).toEqual([]);
    // …can't delete or overwrite them…
    await as(BOB, (tx) => removeFavorite(tx, id(ALICE), placeIds["jasmine-beans"]));
    await as(BOB, (tx) => tx.query("delete from user_payment_methods where user_id = $1", [id(ALICE)]));
    await expect(as(BOB, (tx) => tx.query("update user_profiles set display_name = 'hacked' where id = $1 returning id", [id(ALICE)]))).resolves.toEqual([]);
    // …and the anonymous public sees nothing at all.
    expect(await as(ANON, (tx) => tx.query("select * from favorites"))).toEqual([]);
    const alice = await as(ALICE, (tx) => getMe(tx, id(ALICE)));
    expect(alice.favorites.map((f) => f.slug)).toEqual(["jasmine-beans"]);
    expect(alice.cards).toHaveLength(1);
    expect(alice.profile.displayName).toBeNull();
  });
});

describe("safeReturnPath", () => {
  test("only same-site, non-admin paths", () => {
    expect(safeReturnPath("/profile")).toBe("/profile");
    expect(safeReturnPath("/places/kite-and-cup?x=1")).toBe("/places/kite-and-cup?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/admin/review", "javascript:alert(1)", "", null, 42]) {
      expect(safeReturnPath(bad)).toBe("/profile");
    }
  });
});
