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
