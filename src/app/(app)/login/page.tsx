import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { devAuthEnabled, getActor, supabaseConfigured } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/next";
import { devUserSignIn } from "./actions";
import { LinkForm } from "./link-form";

export const metadata: Metadata = { title: "Sign in · BrewPick Lahore" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeReturnPath(sp.next);
  if ((await getActor()).kind === "user") redirect(next);
  return (
    <main className="mx-auto max-w-sm space-y-5 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Optional. Signing in keeps your favourites (and, if you choose, your saved cards) on your account so they follow you to
          other devices. Everything else works without an account.
        </p>
      </div>
      {sp.error === "link" && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          That sign-in link has expired or was already used. Request a new one.
        </p>
      )}
      {supabaseConfigured() ? (
        <LinkForm next={next} />
      ) : devAuthEnabled() ? (
        <form action={devUserSignIn} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <p className="text-sm text-muted-foreground">
            Supabase Auth isn&apos;t configured, so local dev sign-in is on. It&apos;s disabled in production.
          </p>
          <Button type="submit" className="h-11 w-full">
            Continue as dev user
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Sign-in isn&apos;t configured on this server.</p>
      )}
    </main>
  );
}
