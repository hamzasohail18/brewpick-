"use client";

import { cn } from "@/lib/utils";

/** Toggle chip with a 44px tap target. `pressed` is announced to screen readers. */
export function Chip({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        pressed ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A single-choice row of chips, e.g. "Price up to: Any · 500 · 700". */
export function ChipChoice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: { value: T | undefined; label: string }[];
  onChange: (v: T | undefined) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={String(o.value ?? "any")} pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}
