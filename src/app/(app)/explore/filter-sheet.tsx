"use client";

import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Chip, ChipChoice } from "@/components/app/chip";
import { nativeSelect } from "@/components/admin/native-select";
import { getT } from "@/lib/i18n";
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  PLACE_TYPE_LABELS,
  PLACE_TYPES,
  ROAST_LABELS,
  ROASTS,
  type ExploreFilters,
} from "@/lib/explore/filters";

export interface FilterOptions {
  drinks: { slug: string; name: string }[];
  milks: { slug: string; name: string }[];
}

const any = <T,>(label = "Any") => ({ value: undefined as T | undefined, label });

/** Every filter from Section 3F. Changes apply as you tap; the count behind the sheet updates live. */
export function FilterSheet({
  open,
  onOpenChange,
  filters,
  update,
  clearAll,
  options,
  areas,
  resultCount,
  hasOrigin,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: ExploreFilters;
  update: (patch: Partial<ExploreFilters>) => void;
  clearAll: () => void;
  options: FilterOptions;
  areas: { id: number; name: string }[];
  resultCount: number;
  hasOrigin: boolean;
}) {
  const t = getT();
  const toggleAllergen = (a: (typeof ALLERGENS)[number]) => {
    const set = new Set(filters.avoid ?? []);
    if (set.has(a)) set.delete(a);
    else set.add(a);
    update({ avoid: set.size ? [...set].sort() as ExploreFilters["avoid"] : undefined });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-h-[88dvh] max-w-2xl gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b">
          <SheetTitle>{t("explore.filters")}</SheetTitle>
          <SheetDescription>Drinks with missing data are left out of a limit, never counted as zero.</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 overflow-y-auto overscroll-contain p-4">
          <section className="space-y-4" aria-labelledby="f-drink">
            <h3 id="f-drink" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Drink</h3>
            <label className="block space-y-2">
              <span className="text-sm font-medium">Drink type</span>
              <select className={nativeSelect} value={filters.drink ?? ""} onChange={(e) => update({ drink: e.target.value || undefined })}>
                <option value="">Any drink</option>
                {options.drinks.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <ChipChoice
              label="Hot or iced"
              value={filters.temp}
              options={[any(), { value: "hot", label: "Hot" }, { value: "iced", label: "Iced" }]}
              onChange={(temp) => update({ temp })}
            />
            <ChipChoice
              label="Price up to"
              value={filters.maxPrice}
              options={[any(), ...[500, 700, 900, 1200].map((v) => ({ value: v, label: `Rs ${v}` }))]}
              onChange={(maxPrice) => update({ maxPrice })}
            />
            <ChipChoice
              label="Calories up to"
              value={filters.maxKcal}
              options={[any(), ...[50, 150, 250, 400].map((v) => ({ value: v, label: `${v} kcal` }))]}
              onChange={(maxKcal) => update({ maxKcal })}
            />
            <ChipChoice
              label="Sugar up to"
              value={filters.maxSugar}
              options={[any(), ...[5, 15, 30].map((v) => ({ value: v, label: `${v} g` }))]}
              onChange={(maxSugar) => update({ maxSugar })}
            />
            <ChipChoice
              label="Caffeine at least"
              value={filters.minCaffeine}
              options={[any(), ...[100, 150, 200].map((v) => ({ value: v, label: `${v} mg` }))]}
              onChange={(minCaffeine) => update({ minCaffeine })}
            />
            <ChipChoice
              label="Roast"
              value={filters.roast}
              options={[any<(typeof ROASTS)[number]>(), ...ROASTS.map((r) => ({ value: r, label: ROAST_LABELS[r] }))]}
              onChange={(roast) => update({ roast })}
            />
            <ChipChoice
              label="Milk alternative"
              value={filters.milk}
              options={[any(), ...options.milks.map((m) => ({ value: m.slug, label: m.name }))]}
              onChange={(milk) => update({ milk })}
            />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Diet</legend>
              <div className="flex flex-wrap gap-2">
                <Chip pressed={!!filters.dairyFree} onClick={() => update({ dairyFree: filters.dairyFree ? undefined : true })}>
                  Can be made dairy-free / vegan
                </Chip>
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Avoid allergens</legend>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((a) => (
                  <Chip key={a} pressed={!!filters.avoid?.includes(a)} onClick={() => toggleAllergen(a)}>
                    No {ALLERGEN_LABELS[a].toLowerCase()}
                  </Chip>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Based on the drink as served. Drinks with no allergen information are left out. Always check with the cafe if you
                have an allergy.
              </p>
            </fieldset>
          </section>

          <section className="space-y-4" aria-labelledby="f-place">
            <h3 id="f-place" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Place</h3>
            <ChipChoice
              label="Distance"
              value={filters.maxKm}
              options={[any(), ...[1, 3, 5, 10].map((v) => ({ value: v, label: `Within ${v} km` }))]}
              onChange={(maxKm) => update({ maxKm })}
            />
            {!hasOrigin && filters.maxKm && <p className="text-xs text-warning">Set your location to use the distance limit.</p>}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Must have</legend>
              <div className="flex flex-wrap gap-2">
                <Chip pressed={!!filters.openNow} onClick={() => update({ openNow: filters.openNow ? undefined : true })}>Open now</Chip>
                <Chip pressed={!!filters.deals} onClick={() => update({ deals: filters.deals ? undefined : true })}>Has deals</Chip>
                <Chip pressed={!!filters.halal} onClick={() => update({ halal: filters.halal ? undefined : true })}>Halal certified</Chip>
                <Chip pressed={!!filters.family} onClick={() => update({ family: filters.family ? undefined : true })}>Family seating</Chip>
                <Chip pressed={!!filters.wifi} onClick={() => update({ wifi: filters.wifi ? undefined : true })}>Wi-Fi</Chip>
                <Chip pressed={!!filters.driveThru} onClick={() => update({ driveThru: filters.driveThru ? undefined : true })}>Drive-thru</Chip>
              </div>
            </fieldset>
            <ChipChoice
              label="Type"
              value={filters.type}
              options={[any<(typeof PLACE_TYPES)[number]>(), ...PLACE_TYPES.map((p) => ({ value: p, label: PLACE_TYPE_LABELS[p] }))]}
              onChange={(type) => update({ type })}
            />
            <label className="block space-y-2">
              <span className="text-sm font-medium">Area</span>
              <select
                className={nativeSelect}
                value={filters.area ?? ""}
                onChange={(e) => update({ area: e.target.value ? Number(e.target.value) : undefined })}
              >
                <option value="">All of Lahore</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>

        <SheetFooter className="flex-row border-t">
          <Button variant="outline" className="h-11 flex-1" onClick={clearAll}>
            {t("explore.clearAll")}
          </Button>
          <Button className="h-11 flex-[2]" onClick={() => onOpenChange(false)}>
            Show {resultCount} {resultCount === 1 ? "place" : "places"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
