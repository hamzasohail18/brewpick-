import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/db";

export const supabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Dev sign-in lets you use the admin screens locally without Supabase Auth. It is OFF whenever
 * Supabase is configured or NODE_ENV is production, so it can never reach a deployed site.
 */
export const devAuthEnabled = () => !supabaseConfigured() && process.env.NODE_ENV !== "production";

export const DEV_COOKIE = "bp_dev_user";
export const DEV_USERS = {
  admin: { userId: "00000000-0000-4000-8000-00000000ad01", isAdmin: true, email: "dev-admin@localhost" },
  user: { userId: "00000000-0000-4000-8000-00000000a5e1", isAdmin: false, email: "dev-user@localhost" },
} as const;
export type DevUserKey = keyof typeof DEV_USERS;

export type UserActor = Extract<Actor, { kind: "user" }>;

export async function getActor(): Promise<Actor> {
  if (supabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser(); // verifies the JWT with Supabase, unlike getSession()
    if (!data.user) return { kind: "anon" };
    return {
      kind: "user",
      userId: data.user.id,
      email: data.user.email ?? null,
      isAdmin: data.user.app_metadata?.role === "admin",
    };
  }
  if (devAuthEnabled()) {
    const key = (await cookies()).get(DEV_COOKIE)?.value;
    if (key === "admin" || key === "user") return { kind: "user", ...DEV_USERS[key] };
  }
  return { kind: "anon" };
}

/** Use at the top of every admin page and server action. */
export async function requireAdmin(next = "/admin/sources"): Promise<UserActor> {
  const actor = await getActor();
  if (actor.kind !== "user") redirect(`/admin/login?next=${encodeURIComponent(next)}`);
  if (!actor.isAdmin) redirect("/admin/login?error=not_admin");
  return actor;
}
