"use client";

// The compare tray: what the user has picked to compare, kept in this browser only.

import { useSyncExternalStore } from "react";
import { compareHref, MAX_COMPARE } from "./params";

export type TrayEntry =
  | { kind: "size"; id: string; label: string }
  | { kind: "place"; slug: string; label: string };

const KEY = "bp.compare";
const EMPTY: TrayEntry[] = [];
let entries: TrayEntry[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

const keyOf = (e: TrayEntry) => (e.kind === "size" ? `size:${e.id}` : `place:${e.slug}`);

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(raw)) entries = raw.filter((e) => e && (e.kind === "size" || e.kind === "place")).slice(0, MAX_COMPARE);
  } catch {
    // storage blocked or corrupt: start empty
  }
}

function commit(next: TrayEntry[]) {
  entries = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // not remembered across visits, but still works for this page
  }
  listeners.forEach((l) => l());
}

export function inTray(e: TrayEntry) {
  return entries.some((x) => keyOf(x) === keyOf(e));
}

/** Add or remove. Returns false when adding would go over the limit. */
export function toggleTray(e: TrayEntry): boolean {
  load();
  if (inTray(e)) {
    commit(entries.filter((x) => keyOf(x) !== keyOf(e)));
    return true;
  }
  if (entries.length >= MAX_COMPARE) return false;
  commit([...entries, e]);
  return true;
}

export const clearTray = () => commit([]);

export function trayHref(list: TrayEntry[]) {
  return compareHref({
    items: list.flatMap((e) => (e.kind === "size" ? [e.id] : [])),
    places: list.flatMap((e) => (e.kind === "place" ? [e.slug] : [])),
  });
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  // Keep tabs in sync.
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== KEY) return;
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

export function useTray(): TrayEntry[] {
  return useSyncExternalStore(subscribe, () => entries, () => EMPTY);
}
