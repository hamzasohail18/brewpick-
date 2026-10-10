"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { purgeSampleAction, type PurgeState } from "./actions";

export function PurgeSample({ places, deals }: { places: number; deals: number }) {
  const [state, action, pending] = useActionState<PurgeState, FormData>(purgeSampleAction, {});
  if (state.removed) {
    return (
      <p role="status" className="text-sm">
        Removed {state.removed.places} sample places and {state.removed.deals} deals.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {places} fictional sample places and {deals} deals are loaded for development. They carry a &ldquo;Sample data&rdquo;
        badge. Remove them before launch, or once real data is in.
      </p>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="confirm" className="size-5 accent-destructive" />
        Permanently remove all sample places, menus, prices and deals
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="destructive" className="h-11" disabled={pending}>
        {pending ? "Removing…" : "Remove sample data"}
      </Button>
    </form>
  );
}
