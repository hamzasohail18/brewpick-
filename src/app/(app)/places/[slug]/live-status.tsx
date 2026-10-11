"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Tone } from "@/components/app/badges";
import { formatDistance } from "@/lib/capture/geo";
import { describeOpenStatus, openStatus, type HoursRow } from "@/lib/explore/hours";
import { useNow, useOrigin } from "@/lib/explore/origin";
import { distanceM, formatTravel, travelEstimate, TRAVEL_ASSUMPTIONS_TEXT } from "@/lib/explore/travel";

const PlacesMap = dynamic(() => import("@/components/app/places-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
});

/** Open now + distance: computed on the phone (Lahore time; location never leaves the device). */
export function LiveStatus({ hours, lat, lng }: { hours: HoursRow[]; lat: number; lng: number }) {
  const now = useNow();
  const { origin } = useOrigin();
  const status = now ? describeOpenStatus(openStatus(hours, now)) : null;
  const d = origin ? distanceM(origin, { lat, lng }) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {status ? <Tone tone={status.tone} className="text-sm">{status.label}</Tone> : <span className="h-4 w-28 animate-pulse rounded bg-muted" />}
      {d !== null && (
        <span title={TRAVEL_ASSUMPTIONS_TEXT}>
          {formatDistance(d)}
          {origin?.kind === "gps" ? ` · ~${formatTravel(travelEstimate(d))}` : ` from ${origin?.name}`}
        </span>
      )}
    </div>
  );
}

/** Leaflet and its tiles load only when the map is about to scroll into view (it sits below the fold). */
export function MiniMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div ref={ref} className="h-48 overflow-hidden rounded-xl border">
      {near ? (
        <PlacesMap className="h-full w-full" zoom={16} interactive={false} pins={[{ id: "here", lat, lng, label: "☕", title: name }]} />
      ) : (
        <div className="h-full w-full bg-muted" />
      )}
    </div>
  );
}
