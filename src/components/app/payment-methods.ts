"use client";

import { useQuery } from "@tanstack/react-query";
import type { PaymentMethod } from "@/lib/deals/repo";

export function usePaymentMethods() {
  return useQuery({
    queryKey: ["payment-methods"],
    queryFn: async () => {
      const res = await fetch("/api/payment-methods");
      if (!res.ok) throw new Error(`Couldn't load the list (${res.status})`);
      return ((await res.json()) as { methods: PaymentMethod[] }).methods;
    },
    staleTime: 60 * 60_000,
  });
}
