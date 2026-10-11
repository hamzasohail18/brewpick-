"use client";

import { useEffect, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressPhoto } from "@/lib/capture/image";

/**
 * One photo of a menu board, offer poster or document. Shrunk on the phone, which also drops the
 * photo's hidden location/device data; the server strips anything left.
 */
export function ProofPhoto({
  value,
  onChange,
  required,
  label = "Photo proof",
  hint = "A clear photo of the menu or offer. Location data in the photo is removed.",
}: {
  value: Blob | null;
  onChange: (b: Blob | null) => void;
  required?: boolean;
  label?: string;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const url = URL.createObjectURL(value);
    setPreview(url); // eslint-disable-line react-hooks/set-state-in-effect -- mirrors an object URL for the chosen photo
    return () => URL.revokeObjectURL(url);
  }, [value]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {label} {required ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
      </p>
      {value && preview ? (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an unsent photo */}
          <img src={preview} alt="Chosen photo" className="max-h-48 rounded-lg border" />
          <Button type="button" variant="secondary" size="icon" className="absolute top-1 right-1 size-9" aria-label="Remove photo" onClick={() => onChange(null)}>
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-sm font-medium hover:bg-accent">
          <Camera aria-hidden className="size-5" />
          {busy ? "Preparing photo…" : "Take or choose a photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                onChange(await compressPhoto(file));
              } catch {
                setError("Couldn't read that photo. Try another.");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
