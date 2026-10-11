"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, CloudOff, Loader2, LocateFixed, MapPin, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nativeSelect } from "@/components/admin/native-select";
import { checkGeotag, distanceM, formatDistance } from "@/lib/capture/geo";
import { compressPhoto } from "@/lib/capture/image";
import { listOutbox, putOutbox, removeOutbox, sendCapture, syncOutbox, type OutboxEntry } from "@/lib/capture/outbox";
import { MAX_PHOTOS, type CaptureSubmission } from "@/lib/capture/schema";
import { uuid } from "@/lib/capture/uuid";
import { cn } from "@/lib/utils";

export interface CapturePlace {
  id: string;
  name: string;
  branch_name: string | null;
  area: string | null;
  lat: number;
  lng: number;
  is_sample: boolean;
}

interface Row {
  key: string;
  name: string;
  size: string;
  volume: string;
  price: string;
  temperature: "" | "hot" | "iced";
  /** Price on the live menu, to show what changed. */
  was: number | null;
}

type Loc = { lat: number; lng: number; accuracy_m: number };
type LocState = "idle" | "locating" | "ok" | "denied" | "unavailable";
type Result = { staged: number; reconfirmed: number; rejected: number; removals: number; itemErrors: { row: number; message: string }[] };

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

const placeLabel = (p: CapturePlace) => `${p.name}${p.branch_name ? ` (${p.branch_name})` : ""}`;
const newRow = (r: Partial<Row> = {}): Row => ({ key: uuid(), name: "", size: "Regular", volume: "", price: "", temperature: "", was: null, ...r });

export function CaptureApp({
  places,
  drinkNames,
  maxDistanceM,
  userLabel,
}: {
  places: CapturePlace[];
  drinkNames: string[];
  maxDistanceM: number;
  userLabel: string;
}) {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locState, setLocState] = useState<LocState>("idle");
  const [query, setQuery] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [menuState, setMenuState] = useState<"idle" | "loading" | "loaded" | "cached" | "none">("idle");
  const [tax, setTax] = useState<"" | "yes" | "no">("");
  const [fullMenu, setFullMenu] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "photo" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ place: string; result: Result | null; queued: boolean } | null>(null);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const fileInput = useRef<HTMLInputElement>(null);

  const place = places.find((p) => p.id === placeId) ?? null;
  const geotag = place ? checkGeotag(place, loc, maxDistanceM) : null;

  const refreshOutbox = useCallback(async () => {
    try {
      setOutbox(await listOutbox());
    } catch {
      // IndexedDB blocked (private mode): the outbox just isn't available
    }
  }, []);

  const sync = useCallback(
    async (includeRejected = false) => {
      try {
        await syncOutbox({ includeRejected });
      } finally {
        await refreshOutbox();
      }
    },
    [refreshOutbox],
  );

  // Upload anything waiting on load and whenever the connection comes back.
  useEffect(() => {
    const on = () => void sync();
    window.addEventListener("online", on);
    void sync();
    return () => window.removeEventListener("online", on);
  }, [sync]);

  const locate = () => {
    if (!("geolocation" in navigator)) return setLocState("unavailable");
    setLocState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy });
        setLocState("ok");
      },
      (err) => setLocState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = places.filter((p) => !q || `${p.name} ${p.branch_name ?? ""} ${p.area ?? ""}`.toLowerCase().includes(q));
    const withDistance = matches.map((p) => ({ p, d: loc ? distanceM(p, loc) : null }));
    if (loc) withDistance.sort((a, b) => a.d! - b.d!);
    return withDistance.slice(0, q ? 30 : loc ? 8 : 0);
  }, [places, query, loc]);

  const choosePlace = async (p: CapturePlace) => {
    setPlaceId(p.id);
    setError(null);
    setMenuState("loading");
    const cacheKey = `bp_capture_menu_${p.id}`;
    const toRows = (items: { name: string; size: string; volume_ml: number | null; price_pkr: number; temperature: string }[]) =>
      items.map((i) =>
        newRow({
          name: i.name,
          size: i.size,
          volume: i.volume_ml ? `${i.volume_ml}ml` : "",
          price: String(i.price_pkr),
          temperature: i.temperature === "iced" ? "iced" : i.temperature === "hot" ? "hot" : "",
          was: i.price_pkr,
        }),
      );
    try {
      const res = await fetch(`/api/capture/menu/${p.id}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const { items } = await res.json();
      try {
        localStorage.setItem(cacheKey, JSON.stringify(items));
      } catch {
        // storage full or blocked: fine, just no offline prefill next time
      }
      setRows(items.length ? toRows(items) : [newRow()]);
      setMenuState(items.length ? "loaded" : "none");
    } catch {
      let cached: string | null = null;
      try {
        cached = localStorage.getItem(cacheKey);
      } catch {
        // ignore
      }
      const items = cached ? JSON.parse(cached) : [];
      setRows(items.length ? toRows(items) : [newRow()]);
      setMenuState(items.length ? "cached" : "none");
    }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("photo");
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const added = await Promise.all([...files].slice(0, room).map((f) => compressPhoto(f)));
      setPhotos((prev) => [...prev, ...added.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))]);
      setCapturedAt((c) => c ?? new Date().toISOString());
    } catch {
      setError("That photo couldn't be read. Try taking it again.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const updateRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const filledRows = rows.filter((r) => r.name.trim() && r.price.trim());
  const blockers = [
    !place && "Choose the place",
    geotag?.status === "far" && `You're ${formatDistance(geotag.distanceM!)} away; capture in the shop`,
    photos.length === 0 && "Add a photo of the menu",
    filledRows.length === 0 && "Enter at least one price",
  ].filter(Boolean) as string[];

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setCapturedAt(null);
    setRows([]);
    setPlaceId(null);
    setQuery("");
    setTax("");
    setFullMenu(false);
    setNotes("");
    setMenuState("idle");
    setError(null);
  };

  const submit = async () => {
    if (!place || blockers.length) return;
    setBusy("sending");
    setError(null);
    const submission: CaptureSubmission = {
      id: uuid(),
      place_id: place.id,
      captured_at: capturedAt ?? new Date().toISOString(),
      location: loc,
      items: filledRows.map((r) => ({ name: r.name.trim(), size: r.size.trim(), volume: r.volume.trim(), price: r.price.trim(), temperature: r.temperature })),
      tax_inclusive: tax,
      full_menu: fullMenu,
      notes: notes.trim(),
    };
    const blobs = photos.map((p) => p.blob);
    const r = await sendCapture(submission, blobs);
    if (r.ok) {
      setResult({ place: placeLabel(place), result: r.body as unknown as Result, queued: false });
      reset();
    } else if (r.retry) {
      // No signal (or server busy): keep it on the phone and upload later.
      try {
        await putOutbox({ id: submission.id, placeName: placeLabel(place), submission, photos: blobs, createdAt: new Date().toISOString(), lastError: null });
        await refreshOutbox();
        setResult({ place: placeLabel(place), result: null, queued: true });
        reset();
      } catch {
        setError("No connection, and this browser can't store captures offline. Try again when you have signal.");
      }
    } else {
      const issues = Array.isArray(r.body?.issues) ? ` ${(r.body!.issues as string[]).join("; ")}` : "";
      setError(`${String(r.body?.error ?? "The server refused this capture.")}${issues}`);
    }
    setBusy(null);
  };

  if (result) {
    const res = result.result;
    return (
      <Shell userLabel={userLabel} online={online}>
        <div className="space-y-4 rounded-xl border bg-card p-5" role="status">
          {result.queued ? (
            <>
              <CloudOff aria-hidden className="size-8 text-warning" />
              <h2 className="text-lg font-semibold">Saved on this phone</h2>
              <p className="text-sm text-muted-foreground">
                No connection right now. The capture for {result.place} will upload by itself when you&apos;re back online.
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 aria-hidden className="size-8 text-success" />
              <h2 className="text-lg font-semibold">Sent for review</h2>
              <p className="text-sm">
                {result.place}: {res!.staged} new or changed price{res!.staged === 1 ? "" : "s"} for review, {res!.reconfirmed} unchanged
                (marked as checked today){res!.removals ? `, ${res!.removals} item(s) proposed for removal` : ""}.
              </p>
              {res!.rejected + res!.itemErrors.length > 0 && (
                <p className="text-sm text-destructive">
                  {res!.rejected + res!.itemErrors.length} row(s) couldn&apos;t be used
                  {res!.itemErrors.length ? `: ${res!.itemErrors.map((e) => `row ${e.row} (${e.message})`).join(", ")}` : "."}
                </p>
              )}
            </>
          )}
          <Button className="h-11 w-full" onClick={() => setResult(null)}>
            Capture another menu
          </Button>
        </div>
        <OutboxPanel outbox={outbox} online={online} onSync={() => sync(true)} onDiscard={async (id) => (await removeOutbox(id), refreshOutbox())} />
      </Shell>
    );
  }

  return (
    <Shell userLabel={userLabel} online={online}>
      <OutboxPanel outbox={outbox} online={online} onSync={() => sync(true)} onDiscard={async (id) => (await removeOutbox(id), refreshOutbox())} />

      {/* 1. Place */}
      <Step n={1} title="Where are you?">
        {place ? (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3">
              <div>
                <div className="font-medium">{placeLabel(place)}</div>
                <div className="text-sm text-muted-foreground">
                  {place.area ?? "Lahore"}
                  {place.is_sample && " · sample place"}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-11" onClick={() => (setPlaceId(null), setRows([]), setMenuState("idle"))}>
                Change
              </Button>
            </div>
            <GeotagNote geotag={geotag} locState={locState} onLocate={locate} maxDistanceM={maxDistanceM} />
          </div>
        ) : (
          <div className="space-y-3">
            <Button type="button" variant="secondary" className="h-11 w-full" onClick={locate} disabled={locState === "locating"}>
              {locState === "locating" ? <Loader2 aria-hidden className="animate-spin" /> : <LocateFixed aria-hidden />}
              {loc ? "Update my location" : "Use my location"}
            </Button>
            {locState === "denied" && (
              <p className="text-sm text-muted-foreground">Location is blocked. Search instead; the reviewer will be told it wasn&apos;t checked.</p>
            )}
            {locState === "unavailable" && <p className="text-sm text-muted-foreground">Couldn&apos;t get a location. Search instead.</p>}
            <div className="space-y-1">
              <label htmlFor="place-search" className="text-sm font-medium">
                Search places
              </label>
              <Input id="place-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or area" className="h-11" autoComplete="off" />
            </div>
            {listed.length > 0 && (
              <ul className="divide-y rounded-lg border bg-background" aria-label="Places">
                {listed.map(({ p, d }) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => choosePlace(p)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent">
                      <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{placeLabel(p)}</span>
                        <span className="block text-xs text-muted-foreground">{p.area ?? "Lahore"}</span>
                      </span>
                      {d !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDistance(d)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query && listed.length === 0 && <p className="text-sm text-muted-foreground">No place matches &ldquo;{query}&rdquo;.</p>}
          </div>
        )}
      </Step>

      {/* 2. Photos */}
      <Step n={2} title="Photograph the menu" disabled={!place}>
        <p className="text-sm text-muted-foreground">Get the prices in frame and readable. Up to {MAX_PHOTOS} photos.</p>
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2" aria-label="Menu photos">
            {photos.map((p, i) => (
              <li key={p.url} className="relative aspect-[3/4] overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={p.url} alt={`Menu photo ${i + 1}`} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => (URL.revokeObjectURL(p.url), setPhotos((ps) => ps.filter((x) => x !== p)))}
                  className="absolute top-1 right-1 grid size-9 place-items-center rounded-full bg-background/90"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileInput}
          id="photo-input"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          onChange={(e) => addPhotos(e.target.files)}
          disabled={!place || photos.length >= MAX_PHOTOS}
        />
        <Button
          type="button"
          variant="secondary"
          className="h-12 w-full"
          onClick={() => fileInput.current?.click()}
          disabled={!place || busy === "photo" || photos.length >= MAX_PHOTOS}
        >
          {busy === "photo" ? <Loader2 aria-hidden className="animate-spin" /> : <Camera aria-hidden />}
          {photos.length ? "Add another photo" : "Take photo"}
        </Button>
      </Step>

      {/* 3. Prices */}
      <Step n={3} title="Check the prices" disabled={!place}>
        {menuState === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Loading the current menu…
          </p>
        )}
        {(menuState === "loaded" || menuState === "cached") && (
          <p className="text-sm text-muted-foreground">
            Filled in from the current menu{menuState === "cached" ? " (saved copy; you're offline)" : ""}. Change what&apos;s different,
            remove what&apos;s gone, add what&apos;s new.
          </p>
        )}
        {menuState === "none" && <p className="text-sm text-muted-foreground">No menu on file yet. Add each drink and size.</p>}

        <datalist id="drink-names">
          {[...new Set([...drinkNames, ...rows.map((r) => r.name).filter(Boolean)])].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id="size-names">
          {["Single", "Double", "Small", "Regular", "Large"].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <ul className="space-y-3">
          {rows.map((r, i) => {
            const changed = r.was !== null && r.price.trim() !== "" && Number(r.price.replace(/[^\d.]/g, "")) !== r.was;
            return (
              <li key={r.key} className={cn("space-y-2 rounded-lg border bg-background p-3", changed && "border-warning")}>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`name-${r.key}`}>
                    Item {i + 1} name
                  </label>
                  <Input
                    id={`name-${r.key}`}
                    list="drink-names"
                    value={r.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    placeholder="Drink (e.g. Cafe Latte)"
                    className="h-11 flex-1"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    aria-label={`Remove ${r.name || `item ${i + 1}`}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground" htmlFor={`size-${r.key}`}>
                      Size
                    </label>
                    <Input id={`size-${r.key}`} list="size-names" value={r.size} onChange={(e) => updateRow(r.key, { size: e.target.value })} className="h-11" autoComplete="off" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground" htmlFor={`vol-${r.key}`}>
                      Volume
                    </label>
                    <Input id={`vol-${r.key}`} value={r.volume} onChange={(e) => updateRow(r.key, { volume: e.target.value })} placeholder="ml / oz" className="h-11" autoComplete="off" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground" htmlFor={`price-${r.key}`}>
                      Price (Rs.)
                    </label>
                    <Input
                      id={`price-${r.key}`}
                      value={r.price}
                      onChange={(e) => updateRow(r.key, { price: e.target.value })}
                      inputMode="numeric"
                      className="h-11 font-medium tabular-nums"
                      autoComplete="off"
                    />
                  </div>
                </div>
                {changed && (
                  <p className="text-xs">
                    Was Rs. {r.was!.toLocaleString("en-PK")} <span className="text-muted-foreground">(changed)</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setRows((rs) => [...rs, newRow()])} disabled={!place}>
          <Plus aria-hidden /> Add a drink
        </Button>

        <div className="grid gap-3 pt-2">
          <div className="space-y-1">
            <label htmlFor="tax" className="text-sm font-medium">
              Do menu prices include tax?
            </label>
            <select id="tax" value={tax} onChange={(e) => setTax(e.target.value as typeof tax)} className={nativeSelect}>
              <option value="">Not stated</option>
              <option value="yes">Yes, tax included</option>
              <option value="no">No, tax added at the till</option>
            </select>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" checked={fullMenu} onChange={(e) => setFullMenu(e.target.checked)} className="mt-0.5 size-5 accent-primary" />
            <span>
              This is the <strong>whole</strong> coffee menu
              <span className="block text-xs text-muted-foreground">Drinks on file but not listed here will be proposed for removal.</span>
            </span>
          </label>
          <div className="space-y-1">
            <label htmlFor="notes" className="text-sm font-medium">
              Note for the reviewer <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="e.g. oat milk +Rs. 150, card machine down" />
          </div>
        </div>
      </Step>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {blockers.length > 0 && <p className="text-xs text-muted-foreground">{blockers[0]}.</p>}
        <Button className="h-12 w-full text-base" onClick={submit} disabled={blockers.length > 0 || busy !== null}>
          {busy === "sending" ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {busy === "sending" ? "Sending…" : `Submit ${filledRows.length || ""} price${filledRows.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ children, userLabel, online }: { children: React.ReactNode; userLabel: string; online: boolean }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Menu Capture</h1>
          <p className="text-xs text-muted-foreground">{userLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          {!online && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-1 text-xs">
              <CloudOff aria-hidden className="size-3.5" /> Offline
            </span>
          )}
          <Link href="/admin/review" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Admin
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}

function Step({ n, title, disabled, children }: { n: number; title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className={cn("space-y-3 rounded-xl border bg-card p-4", disabled && "opacity-50")}>
      <h2 id={`step-${n}`} className="flex items-center gap-2 font-semibold">
        <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function GeotagNote({
  geotag,
  locState,
  onLocate,
  maxDistanceM,
}: {
  geotag: ReturnType<typeof checkGeotag> | null;
  locState: LocState;
  onLocate: () => void;
  maxDistanceM: number;
}) {
  if (!geotag || geotag.status === "missing") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-warning/10 p-3 text-sm">
        <span>
          {locState === "denied" ? "Location is blocked." : "Location not checked yet."} Without it the reviewer is told the place wasn&apos;t verified.
        </span>
        {locState !== "denied" && (
          <Button type="button" variant="secondary" size="sm" className="h-11 shrink-0" onClick={onLocate} disabled={locState === "locating"}>
            {locState === "locating" ? <Loader2 aria-hidden className="animate-spin" /> : "Check"}
          </Button>
        )}
      </div>
    );
  }
  if (geotag.status === "far") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        <span>
          You&apos;re {formatDistance(geotag.distanceM!)} away. Captures must be made in the shop (within {maxDistanceM} m).
        </span>
        <Button type="button" variant="secondary" size="sm" className="h-11 shrink-0" onClick={onLocate}>
          Recheck
        </Button>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm">
      <CheckCircle2 aria-hidden className="size-4 text-success" /> You&apos;re here ({formatDistance(geotag.distanceM!)}, ±{geotag.accuracyM} m).
    </p>
  );
}

function OutboxPanel({
  outbox,
  online,
  onSync,
  onDiscard,
}: {
  outbox: OutboxEntry[];
  online: boolean;
  onSync: () => void;
  onDiscard: (id: string) => void;
}) {
  if (outbox.length === 0) return null;
  return (
    <Alert className="border-warning/60 bg-warning/10">
      <CloudOff aria-hidden className="text-warning" />
      <AlertTitle>
        {outbox.length} capture{outbox.length === 1 ? "" : "s"} waiting to upload
      </AlertTitle>
      <AlertDescription className="space-y-2 text-foreground">
        <ul className="space-y-1 text-sm">
          {outbox.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate">{e.placeName}</span>
                {e.lastError && <span className="block text-xs text-destructive">{e.lastError}</span>}
              </span>
              <Button variant="ghost" size="sm" className="h-11 shrink-0" onClick={() => onDiscard(e.id)} aria-label={`Discard capture for ${e.placeName}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="h-11" onClick={onSync} disabled={!online}>
          <RefreshCw aria-hidden /> {online ? "Upload now" : "Waiting for a connection"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
