"use client";

// Where distances are measured from: the phone's GPS position or a chosen area's centre.
// GPS coordinates stay in memory on this device. They are never stored or sent to the server.
// Only the *choice* is remembered (area id, or "use GPS"), so returning visitors don't re-pick.

import { createContext, useContext, useSyncExternalStore } from "react";

export type Origin =
  | { kind: "gps"; lat: number; lng: number; accuracyM: number }
  | { kind: "area"; areaId: number; name: string; lat: number; lng: number };

export type OriginStatus = "idle" | "locating" | "denied" | "unavailable" | "insecure";

export interface OriginState {
  origin: Origin | null;
  status: OriginStatus;
}

type Saved = { kind: "gps" } | { kind: "area"; areaId: number; name: string; lat: number; lng: number };

const KEY = "bp.origin";
let state: OriginState = { origin: null, status: "idle" };
let started = false;
const listeners = new Set<() => void>();
const SERVER_STATE: OriginState = { origin: null, status: "idle" };

function set(next: Partial<OriginState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode / storage blocked: the choice just isn't remembered
  }
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = load();
  if (saved?.kind === "area") {
    set({ origin: { ...saved, kind: "area" } });
  } else if (saved?.kind === "gps") {
    // Only re-locate silently when permission is already granted; never pop a prompt on page load.
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (p.state === "granted") locate();
      })
      .catch(() => {});
  }
}

/** Ask for the phone's position (call from a tap so the permission prompt has context). */
export function locate() {
  if (typeof window === "undefined") return;
  if (!window.isSecureContext) return set({ status: "insecure" });
  if (!("geolocation" in navigator)) return set({ status: "unavailable" });
  set({ status: "locating" });
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      save({ kind: "gps" });
      set({
        status: "idle",
        origin: { kind: "gps", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) },
      });
    },
    (err) => set({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
  );
}

export function chooseArea(area: { id: number; name: string; lat: number; lng: number }) {
  save({ kind: "area", areaId: area.id, name: area.name, lat: area.lat, lng: area.lng });
  set({ status: "idle", origin: { kind: "area", areaId: area.id, name: area.name, lat: area.lat, lng: area.lng } });
}

export function clearOrigin() {
  save(null);
  set({ origin: null, status: "idle" });
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
}

export function useOrigin(): OriginState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/**
 * The minute the server rendered at (minutes since epoch; 0 = unknown). The first client render uses it
 * too, so "open now", deal status and the lists built on them match the server HTML instead of
 * re-sorting and shifting the page right after load.
 */
export const ServerMinuteContext = createContext(0);

/** Current time, ticking each minute (for "open now"); the server's minute until the page has hydrated. */
let nowMinute = 0;
const nowListeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribeNow(l: () => void) {
  nowListeners.add(l);
  if (!timer) {
    timer = setInterval(() => {
      nowMinute = Math.floor(Date.now() / 60_000);
      nowListeners.forEach((fn) => fn());
    }, 30_000);
  }
  return () => {
    nowListeners.delete(l);
    if (nowListeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
export function useNow(): Date | null {
  const serverMinute = useContext(ServerMinuteContext);
  const minute = useSyncExternalStore(
    subscribeNow,
    () => (nowMinute ||= Math.floor(Date.now() / 60_000)),
    () => serverMinute,
  );
  return minute ? new Date(minute * 60_000) : null;
}
