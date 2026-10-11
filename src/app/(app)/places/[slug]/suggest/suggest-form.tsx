"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip, ChipChoice } from "@/components/app/chip";
import { ProofPhoto } from "@/components/app/proof-photo";
import { nativeSelect } from "@/components/admin/native-select";
import { DAY_NAMES, type HoursRow } from "@/lib/explore/hours";
import { DEAL_TYPE_LABELS } from "@/lib/explore/format";
import { PROOF_REQUIRED, type SubmissionType } from "@/lib/community/types";

const TYPES: { value: SubmissionType; label: string }[] = [
  { value: "price_correction", label: "A price changed" },
  { value: "new_item", label: "A drink is missing" },
  { value: "new_deal", label: "A new deal" },
  { value: "hours_correction", label: "Opening hours" },
  { value: "other", label: "Something else" },
];

const DISCOUNTS = { percent: "% off", flat_pkr: "Rs off", fixed_price: "Fixed price", bogo: "Buy one get one", free_item: "Free item" } as const;
const WEEK = [1, 2, 3, 4, 5, 6, 0];

type Hours = { day_of_week: number; opens: string; closes: string; is_closed: boolean };

export function SuggestForm({
  placeId,
  placeSlug,
  sizes,
  hours,
  paymentMethods,
  initialType,
}: {
  placeId: string;
  placeSlug: string;
  sizes: { id: string; label: string }[];
  hours: HoursRow[];
  paymentMethods: string[];
  initialType?: string;
}) {
  const [type, setType] = useState<SubmissionType>(
    TYPES.some((t) => t.value === initialType) ? (initialType as SubmissionType) : sizes.length ? "price_correction" : "new_item",
  );
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { status: string; asOwner: boolean }>(null);

  // per-type fields
  const [sizeId, setSizeId] = useState(sizes[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [tax, setTax] = useState<"" | "yes" | "no">("");
  const [itemName, setItemName] = useState("");
  const [sizeLabel, setSizeLabel] = useState("Regular");
  const [volume, setVolume] = useState("");
  const [temp, setTemp] = useState<"hot" | "iced" | undefined>(undefined);
  const [deal, setDeal] = useState({
    title: "",
    deal_type: "bank_card",
    discount: "percent" as keyof typeof DISCOUNTS,
    value: "",
    cap: "",
    minSpend: "",
    validTo: "",
    days: [] as number[],
    start: "",
    end: "",
    cards: [] as string[],
    terms: "",
    link: "",
  });
  const [week, setWeek] = useState<Hours[]>(() =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const h = hours.find((x) => x.day_of_week === d);
      return { day_of_week: d, opens: h?.opens_at ?? "09:00", closes: h?.closes_at ?? "23:00", is_closed: h ? h.is_closed : false };
    }),
  );
  const [message, setMessage] = useState("");

  const num = (s: string) => (s.trim() ? Number(s) : null);

  function payload(): Record<string, unknown> {
    switch (type) {
      case "price_correction":
        return { type, item_size_id: sizeId, price_pkr: Number(price), tax_inclusive: tax === "" ? null : tax === "yes" };
      case "new_item":
        return { type, display_name: itemName, size_label: sizeLabel || "Regular", volume_ml: num(volume), price_pkr: Number(price), temperature: temp ?? null };
      case "new_deal":
        return {
          type,
          title: deal.title,
          deal_type: deal.deal_type,
          discount: deal.discount,
          discount_value: deal.discount === "bogo" || deal.discount === "free_item" ? null : num(deal.value),
          max_discount_pkr: num(deal.cap),
          min_spend_pkr: num(deal.minSpend),
          valid_to: deal.validTo,
          days_of_week: deal.days.length ? deal.days : null,
          start_time: deal.start || null,
          end_time: deal.start && deal.end ? deal.end : null,
          payment_methods: deal.cards,
          terms: deal.terms || null,
          source_url: deal.link || null,
        };
      case "hours_correction":
        return {
          type,
          hours: week.map((h) => ({ day_of_week: h.day_of_week, opens: h.is_closed ? null : h.opens, closes: h.is_closed ? null : h.closes, is_closed: h.is_closed })),
        };
      case "other":
        return { type, message };
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (PROOF_REQUIRED[type] && !photo) return setError("Add a photo as proof.");
    setSending(true);
    const form = new FormData();
    form.set("place_id", placeId);
    form.set("payload", JSON.stringify(payload()));
    if (note.trim()) form.set("note", note.trim());
    if (photo) form.set("photo", photo, "proof.jpg");
    try {
      const res = await fetch("/api/submissions", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string; asOwner?: boolean };
      if (!res.ok) throw new Error(body.error ?? `Couldn't send (${res.status})`);
      setDone({ status: body.status ?? "pending_review", asOwner: !!body.asOwner });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="space-y-3 rounded-xl border border-success/40 bg-success/10 p-4">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 aria-hidden className="size-5 text-success" /> Thanks, it&apos;s in.
        </p>
        <p className="text-sm">
          {done.status === "published"
            ? "That matches what we have, so we've marked it as checked today."
            : done.asOwner
              ? "As the owner, your update is marked Verified once a reviewer approves it."
              : "A reviewer will check it against your photo. You can follow it on your Profile."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-11">
            <Link href={`/places/${placeSlug}`}>Back to the place</Link>
          </Button>
          <Button asChild variant="ghost" className="h-11">
            <Link href="/profile">My submissions</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <ChipChoice
        label="What's wrong or missing?"
        value={type}
        options={TYPES.filter((t) => t.value !== "price_correction" || sizes.length).map((t) => ({ value: t.value, label: t.label }))}
        onChange={(v) => v && setType(v)}
      />

      {type === "price_correction" && (
        <>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Drink and size</span>
            <select className={nativeSelect} value={sizeId} onChange={(e) => setSizeId(e.target.value)} required>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <PriceInput value={price} onChange={setPrice} label="New price (Rs)" />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Does that include tax?</span>
            <select className={nativeSelect} value={tax} onChange={(e) => setTax(e.target.value as typeof tax)}>
              <option value="">Not sure</option>
              <option value="yes">Yes, tax included</option>
              <option value="no">No, tax is added</option>
            </select>
          </label>
        </>
      )}

      {type === "new_item" && (
        <>
          <Field label="Drink name (as on the menu)" value={itemName} onChange={setItemName} required maxLength={80} placeholder="e.g. Pistachio Latte" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size" value={sizeLabel} onChange={setSizeLabel} maxLength={30} />
            <Field label="Volume (ml, if shown)" value={volume} onChange={setVolume} inputMode="numeric" pattern="\d*" />
          </div>
          <PriceInput value={price} onChange={setPrice} label="Price (Rs)" />
          <ChipChoice label="Hot or iced" value={temp} options={[{ value: undefined, label: "Not sure" }, { value: "hot", label: "Hot" }, { value: "iced", label: "Iced" }]} onChange={setTemp} />
        </>
      )}

      {type === "new_deal" && (
        <>
          <Field label="What's the deal?" value={deal.title} onChange={(v) => setDeal({ ...deal, title: v })} required maxLength={120} placeholder="e.g. 20% off with HBL cards" />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Type</span>
            <select className={nativeSelect} value={deal.deal_type} onChange={(e) => setDeal({ ...deal, deal_type: e.target.value })}>
              {Object.entries(DEAL_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Discount</span>
              <select className={nativeSelect} value={deal.discount} onChange={(e) => setDeal({ ...deal, discount: e.target.value as keyof typeof DISCOUNTS })}>
                {Object.entries(DISCOUNTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {deal.discount !== "bogo" && deal.discount !== "free_item" && (
              <Field
                label={deal.discount === "percent" ? "Percent" : "Rs"}
                value={deal.value}
                onChange={(v) => setDeal({ ...deal, value: v })}
                inputMode="decimal"
                required
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max discount (Rs)" value={deal.cap} onChange={(v) => setDeal({ ...deal, cap: v })} inputMode="numeric" />
            <Field label="Min spend (Rs)" value={deal.minSpend} onChange={(v) => setDeal({ ...deal, minSpend: v })} inputMode="numeric" />
          </div>
          <Field label="Valid until" type="date" value={deal.validTo} onChange={(v) => setDeal({ ...deal, validTo: v })} required />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Which days? (none = every day)</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK.map((d) => (
                <Chip key={d} pressed={deal.days.includes(d)} onClick={() => setDeal({ ...deal, days: deal.days.includes(d) ? deal.days.filter((x) => x !== d) : [...deal.days, d] })}>
                  {DAY_NAMES[d].slice(0, 3)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From (optional)" type="time" value={deal.start} onChange={(v) => setDeal({ ...deal, start: v })} />
            <Field label="Until" type="time" value={deal.end} onChange={(v) => setDeal({ ...deal, end: v })} required={!!deal.start} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Needs a card or app? (none = open to everyone)</legend>
            <div className="flex flex-wrap gap-2">
              {paymentMethods.map((m) => (
                <Chip key={m} pressed={deal.cards.includes(m)} onClick={() => setDeal({ ...deal, cards: deal.cards.includes(m) ? deal.cards.filter((x) => x !== m) : [...deal.cards, m] })}>
                  {m}
                </Chip>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Terms (optional)</span>
            <Textarea value={deal.terms} onChange={(e) => setDeal({ ...deal, terms: e.target.value })} maxLength={500} rows={2} />
          </label>
          <Field label="Link to the offer (optional)" type="url" value={deal.link} onChange={(v) => setDeal({ ...deal, link: v })} placeholder="https://" />
        </>
      )}

      {type === "hours_correction" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Opening hours (Lahore time)</legend>
          <ul className="divide-y rounded-xl border">
            {WEEK.map((d) => {
              const h = week.find((x) => x.day_of_week === d)!;
              const set = (patch: Partial<Hours>) => setWeek(week.map((x) => (x.day_of_week === d ? { ...x, ...patch } : x)));
              return (
                <li key={d} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-12 text-sm font-medium">{DAY_NAMES[d].slice(0, 3)}</span>
                  <label className="flex min-h-11 items-center gap-1.5 text-sm">
                    <input type="checkbox" className="size-5 accent-primary" checked={h.is_closed} onChange={(e) => set({ is_closed: e.target.checked })} />
                    Closed
                  </label>
                  {!h.is_closed && (
                    <>
                      <Input type="time" aria-label={`${DAY_NAMES[d]} opens`} value={h.opens} onChange={(e) => set({ opens: e.target.value })} className="h-11 w-28 text-base" required />
                      <span aria-hidden>–</span>
                      <Input type="time" aria-label={`${DAY_NAMES[d]} closes`} value={h.closes} onChange={(e) => set({ closes: e.target.value })} className="h-11 w-28 text-base" required />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Closing before opening means past midnight (e.g. 12:00 – 02:00).</p>
        </fieldset>
      )}

      {type === "other" && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">What should we know?</span>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={5} maxLength={1000} rows={4} />
        </label>
      )}

      {type !== "other" && (
        <ProofPhoto
          value={photo}
          onChange={setPhoto}
          required={PROOF_REQUIRED[type]}
          hint={type === "hours_correction" ? "The hours sign on the door, or a screenshot of the cafe's own page." : undefined}
        />
      )}
      {type !== "other" && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">
            Note for the reviewer <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-12 w-full text-base" disabled={sending}>
        {sending ? "Sending…" : "Send for review"}
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: { label: string; value: string; onChange: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-11 text-base" {...rest} />
    </label>
  );
}

function PriceInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <Field label={label} value={value} onChange={onChange} inputMode="numeric" pattern="\d{2,4}" required placeholder="e.g. 750" />;
}
