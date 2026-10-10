"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { runNowAction, type RunState } from "./actions";

export function RunNowButton({ id, disabled, describedBy }: { id: string; disabled: boolean; describedBy?: string }) {
  const [state, action, pending] = useActionState<RunState, FormData>(runNowAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" className="h-11" disabled={disabled || pending} aria-describedby={describedBy}>
        {pending ? "Queuing…" : "Run now"}
      </Button>
      {state.message && (
        <div role="status" className={state.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {state.message}
          {state.reasons && (
            <ul className="mt-1 list-disc ps-5">
              {state.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
