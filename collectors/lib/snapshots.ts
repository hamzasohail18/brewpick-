// Raw snapshots of what a collector fetched, kept for audit (source_runs.raw_snapshot_url).
// Local folder by default; swap for Supabase Storage / S3 in production by implementing SnapshotStore.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SnapshotStore {
  /** Saves the body and returns a reference stored in source_runs.raw_snapshot_url. */
  save(runId: string, name: string, body: string | Uint8Array): Promise<string>;
}

export function localSnapshotStore(dir = process.env.SNAPSHOT_DIR ?? ".data/snapshots"): SnapshotStore {
  return {
    async save(runId, name, body) {
      // A runtime data folder, not source: keep the bundler from tracing the whole project because of it.
      const folder = join(/*turbopackIgnore: true*/ dir, runId);
      await mkdir(folder, { recursive: true });
      const safe = name.replace(/[^a-z0-9._-]/gi, "_");
      await writeFile(join(/*turbopackIgnore: true*/ folder, safe), body);
      return `snapshots/${runId}/${safe}`;
    },
  };
}

export const memorySnapshotStore = (): SnapshotStore & { saved: Map<string, string | Uint8Array> } => {
  const saved = new Map<string, string | Uint8Array>();
  return {
    saved,
    async save(runId, name, body) {
      const key = `memory/${runId}/${name}`;
      saved.set(key, body);
      return key;
    },
  };
};
