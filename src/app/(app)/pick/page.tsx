import type { Metadata } from "next";
import { Suspense } from "react";
import { PickApp } from "./pick-app";

export const metadata: Metadata = {
  title: "Pick for me · BrewPick Lahore",
  description: "Four quick questions, one coffee recommendation: price after deals, distance, calories and caffeine considered.",
};

export default function PickPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-md animate-pulse px-4 py-4" aria-busy="true" />}>
      <PickApp />
    </Suspense>
  );
}
