// Offline outbox for Menu Capture: captures made without signal wait in IndexedDB and upload later.
// The capture id is generated on the phone, so re-sending after a flaky connection can't duplicate it.

import type { CaptureSubmission } from "./schema";

export interface OutboxEntry {
  id: string;
  placeName: string;
  submission: CaptureSubmission;
  photos: Blob[];
  createdAt: string;
  /** Last failure the server gave (validation, not network); shown so the volunteer can fix or discard. */
  lastError: string | null;
}

export interface SendResult {
  ok: boolean;
  /** true when it's worth retrying later (no network, server busy, signed out). */
  retry: boolean;
  status: number;
  body: Record<string, unknown> | null;
}

const DB_NAME = "brewpick-capture";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export const listOutbox = () => run<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
export const putOutbox = (e: OutboxEntry) => run("readwrite", (s) => s.put(e));
export const removeOutbox = (id: string) => run("readwrite", (s) => s.delete(id));

export async function sendCapture(submission: CaptureSubmission, photos: Blob[]): Promise<SendResult> {
  const form = new FormData();
  form.set("capture", JSON.stringify(submission));
  photos.forEach((p, i) => form.append("photos", p, `menu-${i + 1}.jpg`));
  let res: Response;
  try {
    res = await fetch("/api/capture", { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    return { ok: false, retry: true, status: 0, body: null };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const retry = res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
  return { ok: res.ok, retry, status: res.status, body };
}

/** Upload everything waiting. Stops early when offline; keeps entries the server rejected, with the reason. */
export async function syncOutbox(opts: { includeRejected?: boolean } = {}): Promise<{ sent: number; failed: number; remaining: number }> {
  let sent = 0;
  let failed = 0;
  for (const entry of await listOutbox()) {
    if (entry.lastError && !opts.includeRejected) continue; // needs the volunteer to retry or discard
    const r = await sendCapture(entry.submission, entry.photos);
    if (r.ok) {
      await removeOutbox(entry.id);
      sent++;
    } else if (r.retry) {
      if (r.status === 0) break; // offline: try again later
      failed++;
    } else {
      await putOutbox({ ...entry, lastError: String(r.body?.error ?? `Rejected (${r.status})`) });
      failed++;
    }
  }
  return { sent, failed, remaining: (await listOutbox()).length };
}
