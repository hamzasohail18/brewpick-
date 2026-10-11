import Link from "next/link";
import { Button } from "@/components/ui/button";
import { pendingCount } from "@/lib/admin/review-repo";
import { dbAs } from "@/lib/db";
import { moderationCounts } from "@/lib/community/actions";
import { requireAdmin, devAuthEnabled } from "@/lib/auth/session";
import { signOut } from "../login/actions";

// Each page and server action also calls requireAdmin(); this layout check is not the only gate.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  const pending = await pendingCount(admin);
  const mod = await dbAs(admin, (tx) => moderationCounts(tx));
  const modCount = mod.reports + mod.claims + mod.deals + mod.submissions;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 px-4 py-1 sm:flex-nowrap">
          <Link href="/admin/review" className="font-semibold whitespace-nowrap">
            <span className="sm:hidden">Admin</span>
            <span className="hidden sm:inline">BrewPick admin</span>
          </Link>
          <nav aria-label="Admin" className="order-last -mx-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:mx-0 sm:w-auto">
            <Link href="/admin/review" className="flex min-h-11 items-center gap-1.5 rounded-md px-3 whitespace-nowrap hover:bg-accent">
              Review
              {pending > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
                  {pending}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </Link>
            <Link href="/admin/moderation" className="flex min-h-11 items-center gap-1.5 rounded-md px-3 whitespace-nowrap hover:bg-accent">
              Moderation
              {modCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
                  {modCount}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </Link>
            <Link href="/admin/sources" className="flex min-h-11 items-center rounded-md px-3 hover:bg-accent">
              Sources
            </Link>
            <Link href="/admin/import" className="flex min-h-11 items-center rounded-md px-3 hover:bg-accent">
              Import
            </Link>
            <Link href="/admin/deals/new" className="flex min-h-11 items-center rounded-md px-3 whitespace-nowrap hover:bg-accent">
              Add deal
            </Link>
            <Link href="/capture" className="flex min-h-11 items-center rounded-md px-3 whitespace-nowrap hover:bg-accent">
              Capture
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
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
