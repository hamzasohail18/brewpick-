import { BottomNav } from "@/components/app/bottom-nav";
import { Providers } from "@/components/app/providers";

// Public app shell: thumb-reachable bottom navigation (Section 4). Admin and capture screens sit outside it.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      {children}
      <BottomNav />
    </Providers>
  );
}
