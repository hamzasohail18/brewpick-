import { AccountSync } from "@/components/app/account-sync";
import { BottomNav } from "@/components/app/bottom-nav";
import { CompareTray } from "@/components/app/compare-tray";
import { Providers } from "@/components/app/providers";
import { OfflineBanner } from "@/components/app/service-worker";

// Server render time, handed to the client so its first render matches (see ServerMinuteContext).
const currentMinute = () => Math.floor(Date.now() / 60_000);

// Public app shell: thumb-reachable bottom navigation (Section 4). Admin and capture screens sit outside it.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers serverMinute={currentMinute()}>
      <AccountSync />
      <OfflineBanner />
      {children}
      <CompareTray />
      <BottomNav />
    </Providers>
  );
}
