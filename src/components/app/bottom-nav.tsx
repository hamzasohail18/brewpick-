"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coffee, Compass, Columns3, Tag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT, type MessageKey } from "@/lib/i18n";

const ITEMS: { href: string; key: MessageKey; icon: typeof Coffee; match: (p: string) => boolean }[] = [
  { href: "/", key: "nav.home", icon: Coffee, match: (p) => p === "/" },
  { href: "/explore", key: "nav.explore", icon: Compass, match: (p) => p.startsWith("/explore") || p.startsWith("/places") },
  { href: "/compare", key: "nav.compare", icon: Columns3, match: (p) => p.startsWith("/compare") },
  { href: "/deals", key: "nav.deals", icon: Tag, match: (p) => p.startsWith("/deals") },
  { href: "/profile", key: "nav.profile", icon: User, match: (p) => p.startsWith("/profile") },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = getT();
  return (
    <nav
      data-bottom-nav
      aria-label={t("nav.label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map(({ href, key, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-5", active && "stroke-[2.5]")} />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
