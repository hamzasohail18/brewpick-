import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireAdmin, devAuthEnabled } from "@/lib/auth/session";
import { signOut } from "../login/actions";

// Each page and server action also calls requireAdmin(); this layout check is not the only gate.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
          <Link href="/admin/sources" className="font-semibold">
            BrewPick admin
          </Link>
          <nav aria-label="Admin" className="flex gap-1 text-sm">
            <Link href="/admin/sources" className="rounded-md px-3 py-2 hover:bg-accent">
              Sources
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">
              {admin.email}
              {devAuthEnabled() && " (dev)"}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="h-11">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
