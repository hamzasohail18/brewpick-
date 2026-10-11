import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/next";

// Lands here from the emailed sign-in link: swap the one-time code for a session cookie.
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safeReturnPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  if (supabaseConfigured() && code) {
    const { createClient } = await import("@/lib/supabase/server");
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, url.origin));
}
