"use client";

// The cards and apps the user holds, for deal matching. Names only (payment_methods ids), never card
// numbers. Stored on this phone by default; syncing to an account comes with the Profile step.

import { useSyncExternalStore } from "react";

const KEY = "bp.cards";
const EMPTY: number[] = [];
let cards: number[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(raw)) cards = raw.filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    // storage blocked: start with none
  }
}

function commit(next: number[]) {
  cards = [...new Set(next)].sort((a, b) => a - b);
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch {
    // works for this visit only
  }
  listeners.forEach((l) => l());
}

export function toggleCard(id: number) {
  load();
  commit(cards.includes(id) ? cards.filter((c) => c !== id) : [...cards, id]);
}

export const setCards = (ids: number[]) => commit(ids);

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** Saved card/app ids. Empty during server render (prices then show deals open to everyone). */
export function useCards(): number[] {
  return useSyncExternalStore(subscribe, () => cards, () => EMPTY);
}
