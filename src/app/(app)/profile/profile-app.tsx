"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, CreditCard, Heart, LogIn, LogOut, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SampleBadge } from "@/components/app/badges";
import { CardsButton, usePaymentMethods } from "@/components/app/cards-sheet";
import { nativeSelect } from "@/components/admin/native-select";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n";
import { setCardsFromAccount, useCards } from "@/lib/deals/cards";
import { chooseArea, clearOrigin, useOrigin } from "@/lib/explore/origin";
import { clearTray } from "@/lib/compare/tray";
import {
  clearRecent,
  saveProfile,
  setCardsSync,
  setUsualBudget,
  toggleFavorite,
  useAccount,
  useFavorites,
  useRecent,
  useUsualBudget,
} from "@/lib/profile/client";
import { BUDGETS } from "@/lib/scoring/quiz";
import { userSignOut } from "../login/actions";

export function ProfileApp({
  signedIn: signedInServer,
  email: emailServer,
  areas,
}: {
  signedIn: boolean;
  email: string | null;
  areas: { id: number; name: string; lat: number | null; lng: number | null }[];
}) {
  const t = getT();
  const account = useAccount();
  const signedIn = account.status === "unknown" ? signedInServer : account.status === "signedIn";
  const email = account.email ?? emailServer;
  const favorites = useFavorites();
  const recent = useRecent();
  const cards = useCards();
  const methods = usePaymentMethods();
  const { origin } = useOrigin();
  const budget = useUsualBudget();
  const cardNames = (methods.data ?? []).filter((m) => cards.includes(m.id)).map((m) => m.name);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("nav.profile")}</h1>

      {/* Account */}
      <section aria-labelledby="account" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 id="account" className="sr-only">
          Account
        </h2>
        {signedIn ? (
          <>
            <p className="text-sm">
              Signed in{email ? <> as <strong>{email}</strong></> : ""}. Favourites are kept on your account.
            </p>
            {account.profile && <DisplayName initial={account.profile.displayName ?? ""} />}
            <form action={userSignOut}>
              <Button type="submit" variant="outline" className="h-11">
                <LogOut aria-hidden />
                Sign out
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm">
              You&apos;re not signed in. Everything works without an account; your favourites, cards and recent places are kept on
              this phone. Sign in to keep favourites on any device.
            </p>
            <Button asChild className="h-11">
              <Link href="/login?next=/profile">
                <LogIn aria-hidden />
                Sign in
              </Link>
            </Button>
          </>
        )}
        {account.syncError && (
          <p role="alert" className="text-sm text-destructive">
            {account.syncError}
          </p>
        )}
      </section>

      {/* Favourites */}
      <section aria-labelledby="favs" className="space-y-3">
        <h2 id="favs" className="flex items-center gap-2 text-lg font-semibold">
          <Heart aria-hidden className="size-4" /> Favourites
        </h2>
        {favorites.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Tap <strong>Save</strong> on a place to keep it here.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {favorites.map((f) => (
              <li key={f.placeId} className="flex items-center gap-2 px-3 py-1">
                <Link href={`/places/${f.slug}`} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center">
                  <span className="truncate font-medium">
                    {f.name}
                    {f.branchName && <span className="font-normal text-muted-foreground"> · {f.branchName}</span>}
                  </span>
                  {f.areaName && <span className="text-xs text-muted-foreground">{f.areaName}</span>}
                </Link>
                {f.isSample && <SampleBadge className="hidden min-[400px]:inline-flex" />}
                <Button variant="ghost" size="icon" className="size-11" aria-label={`Remove ${f.name} from favourites`} onClick={() => void toggleFavorite(f)}>
                  <Heart aria-hidden className="fill-current text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently viewed */}
      <section aria-labelledby="recent" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="recent" className="flex items-center gap-2 text-lg font-semibold">
            <Clock aria-hidden className="size-4" /> Recently viewed
          </h2>
          {recent.length > 0 && (
            <Button variant="ghost" className="h-11" onClick={clearRecent}>
              Clear
            </Button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Places you open will show up here (on this phone only).</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {recent.map((r) => (
              <li key={r.placeId} className="shrink-0">
                <Link href={`/places/${r.slug}`} className="flex min-h-14 w-40 flex-col justify-center rounded-xl border bg-card px-3 py-2 hover:bg-accent">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{r.branchName ?? r.areaName ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cards */}
      <section aria-labelledby="cards" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="cards" className="flex items-center gap-2 text-lg font-semibold">
            <CreditCard aria-hidden className="size-4" /> My cards and apps
          </h2>
          <CardsButton compact />
        </div>
        <p className="text-sm text-muted-foreground">
          {cardNames.length ? cardNames.join(", ") : "None yet. Add the banks, wallets and apps you have to see prices after deals."}
        </p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Names only, never card numbers. Kept on this phone unless you choose otherwise below.
        </p>
        {signedIn && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm">
            <input type="checkbox" className="size-5 accent-primary" checked={account.cardsSynced} onChange={(e) => void setCardsSync(e.target.checked)} />
            <span>
              Also keep my cards on my account
              <span className="block text-xs text-muted-foreground">So they&apos;re there when you sign in on another device. Turning this off removes them from the account.</span>
            </span>
          </label>
        )}
      </section>

      {/* Preferences */}
      <section aria-labelledby="prefs" className="space-y-4">
        <h2 id="prefs" className="flex items-center gap-2 text-lg font-semibold">
          <Settings aria-hidden className="size-4" /> Preferences
        </h2>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Home area</span>
          <select
            className={nativeSelect}
            value={origin?.kind === "area" ? origin.areaId : ""}
            onChange={(e) => {
              const a = areas.find((x) => x.id === Number(e.target.value));
              if (a && a.lat !== null && a.lng !== null) {
                chooseArea({ id: a.id, name: a.name, lat: a.lat, lng: a.lng });
                void saveProfile({ default_area_id: a.id });
              } else {
                clearOrigin();
                void saveProfile({ default_area_id: null });
              }
            }}
          >
            <option value="">{origin?.kind === "gps" ? "Using my location" : "Not set"}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-muted-foreground">Distances are measured from here when location isn&apos;t shared.</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Usual budget</span>
          <select className={nativeSelect} value={budget ?? ""} onChange={(e) => void setUsualBudget(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Not set</option>
            {BUDGETS.filter((b) => b.value !== "any").map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          <span className="block text-xs text-muted-foreground">Highlighted first on Home.</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Language</span>
          <select className={nativeSelect} value="en" disabled aria-describedby="lang-note">
            <option value="en">English</option>
            <option value="ur">اردو (Urdu)</option>
          </select>
          <span id="lang-note" className="block text-xs text-muted-foreground">
            Urdu is coming. The app is built for right-to-left text, and the translation is in progress.
          </span>
        </label>
      </section>

      <ClearPhoneData />

      <p className="text-sm">
        <Link href="/about" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t("footer.about")}
        </Link>
      </p>
    </main>
  );
}

function DisplayName({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await saveProfile({ display_name: name.trim() || null });
        setSaved(true);
      }}
    >
      <label className="flex-1 space-y-1.5">
        <span className="text-sm font-medium">Name (optional)</span>
        <Input value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} maxLength={60} className="h-11 text-base" autoComplete="nickname" />
      </label>
      <Button type="submit" variant="outline" className="h-11">
        {saved ? "Saved" : "Save"}
      </Button>
    </form>
  );
}

function ClearPhoneData() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <section aria-labelledby="privacy" className="space-y-2 rounded-xl border border-dashed p-4">
      <h2 id="privacy" className="font-semibold">
        Data on this phone
      </h2>
      <p className="text-sm text-muted-foreground">
        Favourites, recently viewed, saved cards, your area and compare picks are stored in this browser. Clearing them doesn&apos;t touch
        your account.
      </p>
      {done ? (
        <p role="status" className="text-sm text-success">
          Cleared.
        </p>
      ) : confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            className="h-11"
            onClick={() => {
              for (const k of ["bp.favorites", "bp.recent", "bp.budget", "bp.cardsSync"]) {
                try {
                  localStorage.removeItem(k);
                } catch {
                  // ignore
                }
              }
              setCardsFromAccount([]); // local only: never pushes the empty list to the account
              clearOrigin();
              clearTray();
              clearRecent();
              setDone(true);
              window.location.reload();
            }}
          >
            Yes, clear it
          </Button>
          <Button variant="outline" className="h-11" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" className={cn("h-11")} onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden />
          Clear data on this phone
        </Button>
      )}
    </section>
  );
}
