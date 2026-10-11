"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConfirmMenuButton({ placeId }: { placeId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirming" | "sending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-success">
        <BadgeCheck aria-hidden className="size-4" /> {message}
      </p>
    );
  }
  if (state === "confirming" || state === "sending") {
    return (
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p>Every price on your BrewPick listing matches what you charge today?</p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-11"
            disabled={state === "sending"}
            onClick={async () => {
              setState("sending");
              try {
                const res = await fetch("/api/owner/confirm", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ placeId }),
                });
                const body = (await res.json().catch(() => ({}))) as { error?: string; reconfirmed?: number };
                if (!res.ok) throw new Error(body.error ?? `Couldn't confirm (${res.status})`);
                setMessage(`${body.reconfirmed ?? 0} prices confirmed and marked Verified today.`);
                setState("done");
                router.refresh();
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "Couldn't confirm.");
                setState("idle");
              }
            }}
          >
            Yes, all correct
          </Button>
          <Button variant="outline" className="h-11" onClick={() => setState("idle")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Button className="h-11" onClick={() => setState("confirming")}>
        <BadgeCheck aria-hidden /> Confirm my menu is up to date
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
