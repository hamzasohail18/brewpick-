"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEV_COOKIE, devAuthEnabled, supabaseConfigured } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/next";

export type LinkState = { sent?: string; error?: string };

/** Email sign-in link (Supabase Auth). New emails get an account; there's no password to remember. */
export async function sendSignInLink(_prev: LinkState, formData: FormData): Promise<LinkState> {
  if (!supabaseConfigured()) return { error: "Sign-in isn't configured on this server." };
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { error: "Enter a valid email address." };
  const h = await headers();
  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const next = safeReturnPath(formData.get("next"));
  const { createClient } = await import("@/lib/supabase/server");
  const { error } = await (await createClient()).auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { error: "Couldn't send the link. Try again in a minute." };
  return { sent: email.data };
}

export async function devUserSignIn(formData: FormData) {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is disabled");
  (await cookies()).set(DEV_COOKIE, "user", { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(safeReturnPath(formData.get("next")));
}

export async function userSignOut() {
  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    await (await createClient()).auth.signOut();
  }
  (await cookies()).delete(DEV_COOKIE);
  redirect("/profile");
}
