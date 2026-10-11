"use client";

// Phone-side profile data. Favourites and recently viewed live in this browser; when the user is
// signed in, favourites are also kept on the account, and saved cards are too if they opt in.

import { useSyncExternalStore } from "react";
import { currentCards, onCardsChanged, setCardsFromAccount } from "@/lib/deals/cards";
import type { FavoritePlace, Profile } from "./repo";

// ---------- tiny localStorage-backed store ----------

function createStore<T>(key: string, initial: T, validate: (v: unknown) => v is T) {
  let value = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? null : JSON.parse(raw);
      if (parsed !== null && validate(parsed)) value = parsed;
    } catch {
      // storage blocked: keep the default
    }
  };
  return {
    get: () => {
      load();
      return value;
    },
    set: (next: T) => {
      load();
      value = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // this visit only
      }
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      load();
      listeners.add(l);
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        loaded = false;
        load();
        l();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    initial,
  };
}

const isArray = (v: unknown): v is never[] => Array.isArray(v);

// ---------- favourites ----------

const favStore = createStore<FavoritePlace[]>("bp.favorites", [], isArray);
export const useFavorites = () => useSyncExternalStore(favStore.subscribe, favStore.get, () => favStore.initial);
export const isFavorite = (list: FavoritePlace[], placeId: string) => list.some((f) => f.placeId === placeId);

export async function toggleFavorite(place: FavoritePlace) {
  const list = favStore.get();
  const on = !isFavorite(list, place.placeId);
  favStore.set(on ? [place, ...list] : list.filter((f) => f.placeId !== place.placeId));
  if (account.get().status === "signedIn") {
    await post("/api/me/favorites", "POST", on ? { add: [place.placeId] } : { remove: place.placeId });
  }
}

// ---------- recently viewed ----------

export interface RecentPlace extends FavoritePlace {
  at: string;
}
const RECENT_MAX = 12;
const recentStore = createStore<RecentPlace[]>("bp.recent", [], isArray);
export const useRecent = () => useSyncExternalStore(recentStore.subscribe, recentStore.get, () => recentStore.initial);
export function recordView(place: FavoritePlace) {
  const rest = recentStore.get().filter((r) => r.placeId !== place.placeId);
  recentStore.set([{ ...place, at: new Date().toISOString() }, ...rest].slice(0, RECENT_MAX));
}
export const clearRecent = () => recentStore.set([]);

// ---------- usual budget (preselected on Home) ----------

const budgetStore = createStore<number | null>("bp.budget", null, (v): v is number | null => v === null || (typeof v === "number" && v > 0));
export const useUsualBudget = () => useSyncExternalStore(budgetStore.subscribe, budgetStore.get, () => budgetStore.initial);
export async function setUsualBudget(v: number | null) {
  budgetStore.set(v);
  await saveProfile({ default_budget_pkr: v });
}

// ---------- account ----------

export interface AccountState {
  status: "unknown" | "signedOut" | "signedIn";
  email: string | null;
  profile: Profile | null;
  /** Saved cards are kept on the account too (opt-in; off = this phone only). */
  cardsSynced: boolean;
  syncError: string | null;
  /** This user's "did the deal work?" votes, by deal id. */
  dealVotes: Record<string, boolean>;
  /** Places this user manages as the verified owner. */
  ownsPlaces: number;
}

const syncPref = createStore<boolean>("bp.cardsSync", false, (v): v is boolean => typeof v === "boolean");
// In memory only: the email and profile are never written to browser storage.
const account = (() => {
  const initial: AccountState = { status: "unknown", email: null, profile: null, cardsSynced: false, syncError: null, dealVotes: {}, ownsPlaces: 0 };
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    initial,
    get: () => value,
    set: (next: AccountState) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();
export const useAccount = () => useSyncExternalStore(account.subscribe, account.get, () => account.initial);

async function post(url: string, method: "POST" | "PUT" | "PATCH", body: unknown) {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${res.status}`);
    account.set({ ...account.get(), syncError: null });
    return res;
  } catch {
    account.set({ ...account.get(), syncError: "Couldn't save to your account. Your changes are kept on this phone." });
    return null;
  }
}

let loading: Promise<void> | null = null;

/** Fetch /api/me and merge: phone favourites go up, account favourites come down; cards if synced. */
export function loadAccount(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    let me: { signedIn: boolean; email?: string | null; profile?: Profile; favorites?: FavoritePlace[]; cards?: number[]; dealVotes?: Record<string, boolean>; ownsPlaces?: number };
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      me = await res.json();
    } catch {
      return; // offline: keep whatever we know
    }
    if (!me.signedIn) {
      account.set({ ...account.initial, status: "signedOut" });
      return;
    }
    const local = favStore.get();
    const server = me.favorites ?? [];
    const toUpload = local.filter((f) => !isFavorite(server, f.placeId)).map((f) => f.placeId);
    favStore.set([...server, ...local.filter((f) => !isFavorite(server, f.placeId))]);
    const cardsSynced = syncPref.get();
    if (budgetStore.get() === null && me.profile?.defaultBudgetPkr) budgetStore.set(me.profile.defaultBudgetPkr);
    account.set({ status: "signedIn", email: me.email ?? null, profile: me.profile ?? null, cardsSynced, syncError: null, dealVotes: me.dealVotes ?? {}, ownsPlaces: me.ownsPlaces ?? 0 });
    if (toUpload.length) await post("/api/me/favorites", "POST", { add: toUpload });
    if (cardsSynced) {
      const union = [...new Set([...(me.cards ?? []), ...currentCards()])];
      setCardsFromAccount(union);
      if (union.length !== (me.cards ?? []).length) await post("/api/me/cards", "PUT", { ids: union });
    }
  })();
  return loading;
}

/** Turn card sync on (uploads this phone's cards) or off (removes them from the account). */
export async function setCardsSync(on: boolean) {
  syncPref.set(on);
  account.set({ ...account.get(), cardsSynced: on });
  await post("/api/me/cards", "PUT", { ids: on ? currentCards() : [] });
}

export async function saveProfile(patch: Partial<{ display_name: string | null; default_area_id: number | null; default_budget_pkr: number | null }>) {
  const cur = account.get();
  if (cur.status !== "signedIn" || !cur.profile) return;
  account.set({
    ...cur,
    profile: {
      ...cur.profile,
      ...(patch.display_name !== undefined && { displayName: patch.display_name }),
      ...(patch.default_area_id !== undefined && { defaultAreaId: patch.default_area_id }),
      ...(patch.default_budget_pkr !== undefined && { defaultBudgetPkr: patch.default_budget_pkr }),
    },
  });
  await post("/api/me", "PATCH", patch);
}

/** Vote on whether a deal worked (true/false), or take the vote back (null). Returns the new tallies. */
export async function voteDeal(dealId: string, accurate: boolean | null): Promise<{ upvotes: number; downvotes: number } | null> {
  const cur = account.get();
  const dealVotes = { ...cur.dealVotes };
  if (accurate === null) delete dealVotes[dealId];
  else dealVotes[dealId] = accurate;
  account.set({ ...cur, dealVotes });
  const res = await post(`/api/deals/${dealId}/vote`, "POST", { accurate });
  if (!res) {
    account.set({ ...account.get(), dealVotes: cur.dealVotes }); // undo on failure
    return null;
  }
  return (await res.json()) as { upvotes: number; downvotes: number };
}

// Keep the account's cards in step with the phone while sync is on.
if (typeof window !== "undefined") {
  let timer: ReturnType<typeof setTimeout> | null = null;
  onCardsChanged((ids) => {
    const a = account.get();
    if (a.status !== "signedIn" || !a.cardsSynced) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void post("/api/me/cards", "PUT", { ids }), 400);
  });
}
