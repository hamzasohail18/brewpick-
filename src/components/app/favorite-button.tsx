"use client";

import { useEffect } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFavorite, recordView, toggleFavorite, useFavorites } from "@/lib/profile/client";
import type { FavoritePlace } from "@/lib/profile/repo";

export function FavoriteButton({ place }: { place: FavoritePlace }) {
  const favs = useFavorites();
  const on = isFavorite(favs, place.placeId);
  return (
    <Button variant="outline" className="h-11" aria-pressed={on} onClick={() => void toggleFavorite(place)}>
      <Heart aria-hidden className={cn(on && "fill-current text-destructive")} />
      {on ? "Saved" : "Save"}
    </Button>
  );
}

/** Adds the place to "Recently viewed" (kept on this phone only). */
export function RecordView({ place }: { place: FavoritePlace }) {
  useEffect(() => {
    recordView(place);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per place
  }, [place.placeId]);
  return null;
}
