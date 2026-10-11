// Proof photo storage. Local folder in development (served by /uploads/...); swap for Supabase
// Storage in production by implementing the same two functions.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? ".data/uploads";

export function isJpeg(buf: Uint8Array) {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * Remove APP1 (EXIF/XMP) and APP13 (IPTC) segments from a JPEG so a volunteer's GPS position,
 * device and timestamps never get published. Image data is untouched.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (!isJpeg(input)) throw new Error("Not a JPEG");
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) throw new Error("Corrupt JPEG");
    const marker = input[i + 1];
    if (marker === 0xda) {
      // Start of scan: the rest is image data.
      for (let j = i; j < input.length; j++) out.push(input[j]);
      return Uint8Array.from(out);
    }
    const len = (input[i + 2] << 8) | input[i + 3];
    const end = i + 2 + len;
    if (end > input.length) throw new Error("Corrupt JPEG");
    if (marker !== 0xe1 && marker !== 0xed) for (let j = i; j < end; j++) out.push(input[j]);
    i = end;
  }
  throw new Error("Corrupt JPEG");
}

/**
 * Private uploads (owner-claim documents) live outside the public folder and are served only to
 * admins, at /admin/files/<path>.
 */
const PRIVATE_DIR = process.env.PRIVATE_UPLOAD_DIR ?? join(process.cwd(), ".data", "private-uploads");

/**
 * Saves a JPEG (metadata stripped) and returns its path: public "/uploads/2026/10/<uuid>.jpg"
 * (menu and offer proof, shown next to prices) or private "/admin/files/2026/10/<uuid>.jpg".
 */
export async function saveProofJpeg(bytes: Uint8Array, now = new Date(), visibility: "public" | "private" = "public"): Promise<string> {
  const clean = stripJpegMetadata(bytes);
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const name = `${randomUUID()}.jpg`;
  const dir = visibility === "private" ? PRIVATE_DIR : UPLOAD_DIR;
  await mkdir(join(dir, folder), { recursive: true });
  await writeFile(join(dir, folder, name), clean);
  return `${visibility === "private" ? "/admin/files" : "/uploads"}/${folder}/${name}`;
}

/** Reads an upload by its path segments, refusing anything that escapes the upload folder. */
export async function readUpload(segments: string[], visibility: "public" | "private" = "public"): Promise<Uint8Array | null> {
  if (!segments.every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== ".." && s !== ".")) return null;
  const root = normalize(visibility === "private" ? PRIVATE_DIR : UPLOAD_DIR);
  const full = normalize(join(root, ...segments));
  if (!full.startsWith(root + sep)) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}
