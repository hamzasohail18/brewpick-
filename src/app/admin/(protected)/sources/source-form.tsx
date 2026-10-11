"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nativeSelect } from "@/components/admin/native-select";
import { CheckboxField, Field, Section } from "@/components/admin/form-field";
import { AUTOMATION_LABELS, CONFIDENCE_LABELS, KIND_LABELS } from "@/lib/domain/labels";
import { AUTOMATION_STATUSES, CONFIDENCE_LEVELS, SOURCE_KINDS } from "@/lib/domain/sources";
import { cn } from "@/lib/utils";
import { saveSourceAction, type SourceFormState } from "./actions";

export type SourceFormDefaults = Record<string, string>;

export function SourceForm({ id, defaults }: { id: string | null; defaults: SourceFormDefaults }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(saveSourceAction, {});
  const v = (k: string) => state.values?.[k] ?? defaults[k] ?? "";
  const checked = (k: string) => (state.values ? state.values[k] === "on" : defaults[k] === "on");
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form key={state.n ?? 0} action={action} className="space-y-8" noValidate>
      {id && <input type="hidden" name="id" value={id} />}

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert role="status" className="border-success/50 bg-success/10">
          <AlertDescription className="text-foreground">{state.message}</AlertDescription>
        </Alert>
      )}

      <Section title="Identity">
        <Field name="name" label="Name" error={err("name")}>
          {(p) => <Input {...p} defaultValue={v("name")} required />}
        </Field>
        <Field name="slug" label="Slug" hint="e.g. cafe-website-<place-slug>" error={err("slug")}>
          {(p) => <Input {...p} defaultValue={v("slug")} required className={cn(p.className, "font-mono")} />}
        </Field>
        <Field name="kind" label="Kind" error={err("kind")}>
          {(p) => (
            <select {...p} defaultValue={v("kind")} className={nativeSelect}>
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="base_url" label="Base URL" error={err("base_url")}>
          {(p) => <Input {...p} type="url" defaultValue={v("base_url")} placeholder="https://" />}
        </Field>
        <Field name="place_id" label="Place ID" hint="Only for sources that belong to one cafe" error={err("place_id")}>
          {(p) => <Input {...p} defaultValue={v("place_id")} className={cn(p.className, "font-mono")} />}
        </Field>
        <CheckboxField name="is_active" label="Active" defaultChecked={checked("is_active")} />
      </Section>

      <Section
        title="Automation review"
        description="Read robots.txt, the terms of service and any API or data licence before allowing automation. Re-review every 6 months."
      >
        <Field name="automation" label="Automation status" error={err("automation")}>
          {(p) => (
            <select {...p} defaultValue={v("automation")} className={nativeSelect}>
              {AUTOMATION_STATUSES.map((a) => (
                <option key={a} value={a}>
                  {AUTOMATION_LABELS[a]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="robots_checked_at" label="Reviewed on" hint="Required before allowing automation" error={err("robots_checked_at")}>
          {(p) => <Input {...p} type="date" defaultValue={v("robots_checked_at")} />}
        </Field>
        <Field
          name="automation_notes"
          label="Review notes"
          hint="What robots.txt, the ToS and the licence say, and who reviewed it. Required before allowing automation."
          error={err("automation_notes")}
          wide
        >
          {(p) => <Textarea {...p} defaultValue={v("automation_notes")} rows={5} className="min-h-28" />}
        </Field>
        <Field name="tos_url" label="Terms of service URL" error={err("tos_url")}>
          {(p) => <Input {...p} type="url" defaultValue={v("tos_url")} placeholder="https://" />}
        </Field>
        <Field name="license" label="Licence" hint="e.g. ODbL, API terms" error={err("license")}>
          {(p) => <Input {...p} defaultValue={v("license")} />}
        </Field>
      </Section>

      <Section title="Attribution" description="Sources that require attribution are listed on the About page and in the app footer.">
        <CheckboxField name="attribution_required" label="Attribution required" defaultChecked={checked("attribution_required")} />
        <Field name="attribution_text" label="Attribution text" error={err("attribution_text")}>
          {(p) => <Input {...p} defaultValue={v("attribution_text")} placeholder="© OpenStreetMap contributors" />}
        </Field>
      </Section>

      <Section title="Collector policy">
        <Field name="rate_limit_seconds" label="Seconds between requests" error={err("rate_limit_seconds")}>
          {(p) => <Input {...p} type="number" min={1} step={0.5} defaultValue={v("rate_limit_seconds")} inputMode="decimal" />}
        </Field>
        <Field name="check_interval_days" label="Check every (days)" error={err("check_interval_days")}>
          {(p) => <Input {...p} type="number" min={1} max={365} defaultValue={v("check_interval_days")} inputMode="numeric" />}
        </Field>
        <Field
          name="user_agent"
          label="User-Agent"
          hint="Blank = BrewPickLahore/0.1 with COLLECTOR_CONTACT_EMAIL"
          error={err("user_agent")}
          wide
        >
          {(p) => <Input {...p} defaultValue={v("user_agent")} className={cn(p.className, "font-mono text-xs")} />}
        </Field>
        <CheckboxField name="cache_allowed" label="Caching allowed" defaultChecked={checked("cache_allowed")} />
        <Field name="max_cache_days" label="Max cache days" hint="Blank = no limit" error={err("max_cache_days")}>
          {(p) => <Input {...p} type="number" min={1} defaultValue={v("max_cache_days")} inputMode="numeric" />}
        </Field>
        <Field name="default_confidence" label="Default confidence" error={err("default_confidence")}>
          {(p) => (
            <select {...p} defaultValue={v("default_confidence")} className={nativeSelect}>
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {CONFIDENCE_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" className="h-11 min-w-32" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Create source"}
        </Button>
      </div>
    </form>
  );
}
