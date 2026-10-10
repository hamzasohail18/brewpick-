"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nativeSelect } from "@/components/admin/native-select";
import type { EditableField } from "@/lib/pipeline/review-format";
import { approveAction, rejectAction, type ReviewActionState } from "./actions";

export function ReviewActions({
  id,
  nextId,
  fields,
  original,
  canEdit,
}: {
  id: string;
  nextId: string | null;
  fields: EditableField[];
  original: string;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");
  const [approveState, approve, approving] = useActionState<ReviewActionState, FormData>(approveAction, {});
  const [rejectState, reject, rejecting] = useActionState<ReviewActionState, FormData>(rejectAction, {});
  const busy = approving || rejecting;

  return (
    <div className="space-y-4">
      {approveState.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {approveState.error}
            {approveState.errors && (
              <ul className="mt-1 list-disc ps-5">
                {approveState.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {mode === "edit" ? (
        <form action={approve} className="space-y-4 rounded-lg border bg-card p-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="next_id" value={nextId ?? ""} />
          <input type="hidden" name="mode" value="edit" />
          <input type="hidden" name="original" value={original} />
          <h3 className="font-semibold">Edit before approving</h3>
          <p className="text-sm text-muted-foreground">Changes are re-validated. Lists are comma-separated.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields
              .filter((f) => !f.locked)
              .map((f) => (
                <div key={f.path} className="space-y-1">
                  <label htmlFor={`f-${f.path}`} className="text-xs font-medium">
                    {f.label}
                  </label>
                  {f.type === "boolean" ? (
                    <select id={`f-${f.path}`} name={`f:${f.path}`} defaultValue={f.value} className={nativeSelect}>
                      <option value="">Unknown</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  ) : f.type === "select" ? (
                    <select id={`f-${f.path}`} name={`f:${f.path}`} defaultValue={f.value} className={nativeSelect}>
                      <option value="">—</option>
                      {f.options!.map((o) => (
                        <option key={o} value={o}>
                          {o.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  ) : f.path.endsWith("terms") || f.path.endsWith("assumptions") || f.path.endsWith("tasting_notes") ? (
                    <Textarea id={`f-${f.path}`} name={`f:${f.path}`} defaultValue={f.value} rows={3} />
                  ) : (
                    <Input
                      id={`f-${f.path}`}
                      name={`f:${f.path}`}
                      defaultValue={f.value}
                      className="h-11"
                      inputMode={f.type === "number" ? "decimal" : undefined}
                    />
                  )}
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11" disabled={busy}>
              {approving ? "Publishing…" : "Approve with edits"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : mode === "reject" ? (
        <form action={reject} className="space-y-3 rounded-lg border bg-card p-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="next_id" value={nextId ?? ""} />
          <label htmlFor="reject-note" className="text-sm font-medium">
            Why is this wrong?
          </label>
          <Textarea id="reject-note" name="note" rows={3} required placeholder="e.g. The photo shows Rs. 650, not Rs. 950" autoFocus />
          {rejectState.error && (
            <p role="alert" className="text-sm text-destructive">
              {rejectState.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" className="h-11" disabled={busy}>
              {rejecting ? "Rejecting…" : "Reject"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={approve}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="next_id" value={nextId ?? ""} />
            <Button type="submit" className="h-11 min-w-28" disabled={busy}>
              {approving ? "Publishing…" : "Approve"}
            </Button>
          </form>
          {canEdit && (
            <Button type="button" variant="secondary" className="h-11" onClick={() => setMode("edit")} disabled={busy}>
              Edit…
            </Button>
          )}
          <Button type="button" variant="outline" className="h-11" onClick={() => setMode("reject")} disabled={busy}>
            Reject…
          </Button>
        </div>
      )}
    </div>
  );
}
