"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_COOKIE, devAuthEnabled, supabaseConfigured } from "@/lib/auth/session";

/** Only paths inside the admin area, so `next` can't be used as an open redirect. */
function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/admin/") && !s.startsWith("//") ? s : "/admin/sources";
}

export async function devSignIn(formData: FormData) {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is disabled");
  const as = formData.get("as") === "user" ? "user" : "admin";
  (await cookies()).set(DEV_COOKIE, as, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(safeNext(formData.get("next")));
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
