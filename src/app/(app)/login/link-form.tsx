"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendSignInLink, type LinkState } from "./actions";

export function LinkForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(sendSignInLink, {});
  if (state.sent) {
    return (
      <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
        Check <strong>{state.sent}</strong> for a sign-in link. You can close this tab.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required className="h-11 text-base" />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
