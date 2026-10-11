"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ServerMinuteContext } from "@/lib/explore/origin";

export function Providers({ children, serverMinute }: { children: React.ReactNode; serverMinute: number }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <ServerMinuteContext.Provider value={serverMinute}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ServerMinuteContext.Provider>
  );
}
