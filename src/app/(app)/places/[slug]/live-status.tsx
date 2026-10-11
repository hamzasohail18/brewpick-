"use client";

import dynamic from "next/dynamic";
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

export function MiniMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  return (
    <div className="h-48 overflow-hidden rounded-xl border">
      <PlacesMap
        className="h-full w-full"
        zoom={16}
        interactive={false}
        pins={[{ id: "here", lat, lng, label: "☕", title: name }]}
      />
    </div>
  );
}
