import "server-only";
import { NextResponse } from "next/server";

/**
 * Writes from the browser must come from our own pages. Cookies are SameSite=Lax and the bodies are JSON
 * (which a cross-site form can't send), and this Origin check closes the rest.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export const forbidden = () => json({ error: "Cross-site request refused" }, 403);
export const signedOut = () => json({ error: "Sign in first" }, 401);
export const badRequest = (error: string) => json({ error }, 400);

/** Absolute origin for stored proof URLs (APP_URL in production; the request's host in dev). */
export function publicOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

/**
 * Save one optional JPEG proof photo from a multipart form (metadata stripped by saveProofJpeg).
 * Returns its absolute URL, null when none was sent, or an error message.
 */
export async function saveProofFromForm(
  req: Request,
  form: FormData,
  field = "photo",
  visibility: "public" | "private" = "public",
): Promise<{ url: string | null } | { error: string; status: number }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) return { url: null };
  if (file.size > MAX_PROOF_BYTES) return { error: "The photo is larger than 5 MB.", status: 413 };
  const { isJpeg, saveProofJpeg } = await import("@/lib/uploads");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) return { error: "Photos must be JPEG.", status: 415 };
  return { url: `${publicOrigin(req)}${await saveProofJpeg(bytes, new Date(), visibility)}` };
}
