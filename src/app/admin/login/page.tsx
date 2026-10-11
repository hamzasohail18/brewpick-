import type { Metadata } from "next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { devAuthEnabled, supabaseConfigured } from "@/lib/auth/session";
import { devSignIn } from "./actions";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Admin sign-in · BrewPick Lahore" };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  const notAdmin = sp.error === "not_admin";
  const notVolunteer = sp.error === "not_volunteer";

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">BrewPick admin</h1>
          </CardTitle>
          <CardDescription>Review queue, sources, data tools and Menu Capture.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(notAdmin || notVolunteer) && (
            <Alert variant="destructive">
              <AlertDescription>
                {notAdmin ? "This account isn't an admin." : "Menu Capture is for volunteers and admins."}
              </AlertDescription>
            </Alert>
          )}
          {supabaseConfigured() ? (
            <PasswordForm next={next} />
          ) : devAuthEnabled() ? (
            <form action={devSignIn} className="space-y-3">
              <input type="hidden" name="next" value={next} />
              <p className="text-sm text-muted-foreground">
                Supabase Auth isn&apos;t configured, so local dev sign-in is on. It is disabled in production.
              </p>
              <Button type="submit" name="as" value="admin" className="h-11 w-full">
                Continue as dev admin
              </Button>
              <Button type="submit" name="as" value="volunteer" variant="secondary" className="h-11 w-full">
                Continue as dev volunteer (Menu Capture only)
              </Button>
              <Button type="submit" name="as" value="user" variant="outline" className="h-11 w-full">
                Continue as dev user (no admin rights)
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign-in isn&apos;t configured. Set the Supabase environment variables (see README).
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
