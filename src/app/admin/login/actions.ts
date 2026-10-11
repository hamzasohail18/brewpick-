"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_COOKIE, devAuthEnabled, supabaseConfigured } from "@/lib/auth/session";

/** Only paths inside the admin area, so `next` can't be used as an open redirect. */
function safeNext(v: FormDataEntryValue | null, fallback = "/admin/review") {
  const s = typeof v === "string" ? v : "";
  return (s.startsWith("/admin/") || s === "/capture" || s.startsWith("/capture/")) && !s.startsWith("//") ? s : fallback;
}

export async function devSignIn(formData: FormData) {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is disabled");
  const raw = formData.get("as");
  const as = raw === "user" || raw === "volunteer" ? raw : "admin";
  (await cookies()).set(DEV_COOKIE, as, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(safeNext(formData.get("next"), as === "volunteer" ? "/capture" : "/admin/review"));
}

export type SignInState = { error?: string };

export async function passwordSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  if (!supabaseConfigured()) return { error: "Supabase Auth is not configured." };
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: "Email or password is incorrect." };
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    await (await createClient()).auth.signOut();
  }
  (await cookies()).delete(DEV_COOKIE);
  redirect("/admin/login");
}
