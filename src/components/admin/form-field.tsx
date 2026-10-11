// Labelled admin form fields: label, hint and error wired up with aria-describedby / aria-invalid.

import { useId } from "react";
import { cn } from "@/lib/utils";

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border bg-card p-4">
      <legend className="px-1 text-base font-semibold">{title}</legend>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export type FieldProps = {
  id: string;
  name: string;
  className: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function Field({
  name,
  label,
  hint,
  error,
  wide,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string[];
  wide?: boolean;
  children: (p: FieldProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint && hintId, error && errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, name, className: "h-11", "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-destructive">
          {error.join(" ")}
        </p>
      )}
    </div>
  );
}

export function CheckboxField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 self-end text-sm font-medium">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-5 accent-primary" />
      {label}
    </label>
  );
}
