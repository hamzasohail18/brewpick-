"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { nativeSelect } from "@/components/admin/native-select";
import { importAction, type ImportState } from "./actions";

export function ImportForm({ sources, types }: { sources: { slug: string; name: string }[]; types: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, {});
  const r = state.result;

  return (
    <div className="space-y-6">
      <form action={action} className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="type" className="text-sm font-medium">
            File contains
          </label>
          <select id="type" name="type" className={nativeSelect} defaultValue="prices">
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="source" className="text-sm font-medium">
            Where the data came from
          </label>
          <select id="source" name="source" className={nativeSelect} defaultValue="manual-admin">
            {sources.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="file" className="text-sm font-medium">
            CSV file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block min-h-11 w-full text-sm file:me-3 file:h-11 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:text-secondary-foreground"
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" className="h-11" disabled={pending}>
            {pending ? "Importing…" : "Import for review"}
          </Button>
        </div>
      </form>

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {r && (
        <Alert role="status" className="border-success/50 bg-success/10">
          <AlertTitle>{state.fileName} imported</AlertTitle>
          <AlertDescription className="space-y-2 text-foreground">
            <p>
              {r.staged} waiting for review · {r.reconfirmed} re-confirmed (no changes) · {r.rejected} rejected by the validator
              {r.superseded > 0 && ` · ${r.superseded} older proposals replaced`}
            </p>
            {r.lineErrors.length > 0 && (
              <div>
                <p className="font-medium">{r.lineErrors.length} line(s) couldn&apos;t be read:</p>
                <ul className="list-disc ps-5">
                  {r.lineErrors.slice(0, 20).map((e) => (
                    <li key={`${e.line}-${e.message}`}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.staged > 0 && (
              <Link href="/admin/review" className="inline-block font-medium underline underline-offset-4">
                Go to the review queue
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
