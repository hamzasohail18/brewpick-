"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nativeSelect } from "@/components/admin/native-select";
import { Field, Section } from "@/components/admin/form-field";
import { DEAL_TYPE_LABELS } from "@/lib/explore/format";
import { addDealAction, type ManualDealState } from "./actions";

const DISCOUNTS = { percent: "% off", flat_pkr: "Rs off", fixed_price: "Fixed price (Rs)", bogo: "Buy one get one", free_item: "Free item" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SOURCE_GROUPS: Record<string, string> = {
  bank_offer_page: "Bank offer pages",
  social_manual: "Social media (seen by staff)",
  delivery_app_manual: "Delivery apps",
  manual_admin: "Other",
};

interface Props {
  sources: { slug: string; name: string; kind: string; base_url: string | null }[];
  brands: { id: string; name: string; is_sample: boolean }[];
  places: { id: string; name: string; branch_name: string | null; is_sample: boolean }[];
  methods: { name: string; kind: string }[];
  today: string;
}

export function DealForm({ sources, brands, places, methods, today }: Props) {
  const [state, action, pending] = useActionState<ManualDealState, FormData>(addDealAction, {});
  const v = (k: string, fallback = "") => (state.values as Record<string, unknown> | undefined)?.[k]?.toString() ?? fallback;
  const many = (k: "days" | "payment_methods") => state.values?.[k] ?? [];
  const err = (k: string) => state.fieldErrors?.[k];
  const sample = (s: boolean) => (s ? " (sample)" : "");

  return (
    <form key={state.n ?? 0} action={action} className="space-y-6" noValidate>
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

      <Section title="Where it's published">
        <Field name="source" label="Source" error={err("source")}>
          {(p) => (
            <select {...p} defaultValue={v("source")} className={nativeSelect} required>
              <option value="">Choose…</option>
              {Object.entries(SOURCE_GROUPS).map(([kind, label]) => (
                <optgroup key={kind} label={label}>
                  {sources
                    .filter((s) => s.kind === kind)
                    .map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <Field name="source_url" label="Source URL" hint="The offer page or post. Required for bank offers." error={err("source_url")}>
          {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" defaultValue={v("source_url")} />}
        </Field>
        <Field name="screenshot" label="Screenshot (JPEG, optional)" hint="Kept as proof, e.g. for an Instagram post." wide>
          {(p) => (
            <input
              {...p}
              type="file"
              accept="image/jpeg"
              className="block min-h-11 w-full text-sm file:me-3 file:h-11 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:text-secondary-foreground"
            />
          )}
        </Field>
      </Section>

      <Section title="The deal">
        <Field name="applies_to" label="At" hint="A brand covers every branch." error={err("applies_to")} wide>
          {(p) => (
            <select {...p} defaultValue={v("applies_to")} className={nativeSelect} required>
              <option value="">Choose…</option>
              <optgroup label="Brands (all branches)">
                {brands.map((b) => (
                  <option key={b.id} value={`brand:${b.id}`}>
                    {b.name}
                    {sample(b.is_sample)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="One place">
                {places.map((pl) => (
                  <option key={pl.id} value={`place:${pl.id}`}>
                    {pl.name}
                    {pl.branch_name ? ` (${pl.branch_name})` : ""}
                    {sample(pl.is_sample)}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </Field>
        <Field name="title" label="Title" hint='e.g. "20% off with HBL credit cards"' error={err("title")} wide>
          {(p) => <Input {...p} defaultValue={v("title")} required maxLength={120} />}
        </Field>
        <Field name="deal_type" label="Type" error={err("deal_type")}>
          {(p) => (
            <select {...p} defaultValue={v("deal_type", "bank_card")} className={nativeSelect}>
              {Object.entries(DEAL_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="discount" label="Discount" error={err("discount")}>
          {(p) => (
            <select {...p} defaultValue={v("discount", "percent")} className={nativeSelect}>
              {Object.entries(DISCOUNTS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="discount_value" label="Amount" hint="Percent, or rupees" error={err("discount_value")}>
          {(p) => <Input {...p} inputMode="decimal" defaultValue={v("discount_value")} />}
        </Field>
        <Field name="max_discount_pkr" label="Cap (Rs, optional)" error={err("max_discount_pkr")}>
          {(p) => <Input {...p} inputMode="numeric" defaultValue={v("max_discount_pkr")} />}
        </Field>
        <Field name="min_spend_pkr" label="Minimum spend (Rs, optional)" error={err("min_spend_pkr")}>
          {(p) => <Input {...p} inputMode="numeric" defaultValue={v("min_spend_pkr")} />}
        </Field>
      </Section>

      <Section title="When" description="Copy the dates the source states. If it gives no start date, use the day you saw it.">
        <Field name="valid_from" label="From" error={err("valid_from")}>
          {(p) => <Input {...p} type="date" defaultValue={v("valid_from", today)} required />}
        </Field>
        <Field name="valid_to" label="Until" error={err("valid_to")}>
          {(p) => <Input {...p} type="date" defaultValue={v("valid_to")} required />}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">Days (leave all unticked for every day)</legend>
          <div className="mt-1 flex flex-wrap gap-x-4">
            {DAYS.map((d, i) => (
              <label key={d} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="days" value={i} defaultChecked={many("days").includes(String(i))} className="size-5 accent-primary" />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <Field name="start_time" label="From time (optional)" error={err("start_time")}>
          {(p) => <Input {...p} type="time" defaultValue={v("start_time")} />}
        </Field>
        <Field name="end_time" label="Until time (optional)" error={err("end_time")}>
          {(p) => <Input {...p} type="time" defaultValue={v("end_time")} />}
        </Field>
      </Section>

      <Section title="Who can use it">
        <fieldset className="sm:col-span-2" aria-describedby={err("payment_methods") ? "pm-err" : undefined}>
          <legend className="text-sm font-medium">Payment methods (none = open to everyone)</legend>
          <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
            {methods.map((m) => (
              <label key={m.name} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="payment_methods"
                  value={m.name}
                  defaultChecked={many("payment_methods").includes(m.name)}
                  className="size-5 accent-primary"
                />
                {m.name}
              </label>
            ))}
          </div>
          {err("payment_methods") && (
            <p id="pm-err" className="text-xs font-medium text-destructive">
              {err("payment_methods")!.join(" ")}
            </p>
          )}
        </fieldset>
        <Field name="terms" label="Terms (optional)" hint="Short, in your own words." error={err("terms")} wide>
          {(p) => <Textarea {...p} className="min-h-24" defaultValue={v("terms")} maxLength={1000} />}
        </Field>
      </Section>

      <Button type="submit" className="h-11" disabled={pending}>
        {pending ? "Sending…" : "Send to review"}
      </Button>
    </form>
  );
}
