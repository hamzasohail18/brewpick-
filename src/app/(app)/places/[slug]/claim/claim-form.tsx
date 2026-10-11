"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProofPhoto } from "@/components/app/proof-photo";

const METHODS = {
  phone_call: { label: "Call the cafe", hint: "We call the number listed for the cafe and ask for you." },
  business_email: { label: "Business email", hint: "We email an address on the cafe's own domain." },
  document: { label: "Upload a document", hint: "A photo of a business registration, utility bill or similar in the cafe's name." },
} as const;
type Method = keyof typeof METHODS;

export function ClaimForm({ placeId, listedPhone }: { placeId: string; listedPhone: string | null }) {
  const [method, setMethod] = useState<Method>(listedPhone ? "phone_call" : "business_email");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(listedPhone ?? "");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState<Blob | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p role="status" className="rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
        Thanks! We&apos;ll verify your claim and let you know. Once approved, you&apos;ll find your place under Profile → Owner portal.
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (method === "document" && !doc) return setError("Add a photo of the document.");
        setState("sending");
        const form = new FormData();
        form.set("place_id", placeId);
        form.set(
          "claim",
          JSON.stringify({
            verification_method: method,
            contact_name: name.trim(),
            contact_phone: phone.trim() || null,
            contact_email: email.trim() || null,
            note: note.trim() || null,
          }),
        );
        if (doc) form.set("document", doc, "document.jpg");
        try {
          const res = await fetch("/api/claims", { method: "POST", body: form });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(body.error ?? `Couldn't send (${res.status})`);
          setState("done");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't send.");
          setState("idle");
        }
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How can we check it&apos;s you?</legend>
        {(Object.keys(METHODS) as Method[]).map((m) => (
          <label key={m} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-accent">
            <input type="radio" name="method" className="mt-0.5 size-5 accent-primary" checked={method === m} onChange={() => setMethod(m)} />
            <span className="text-sm">
              <span className="font-medium">{METHODS[m].label}</span>
              <span className="block text-xs text-muted-foreground">{METHODS[m].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Your name and role</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} className="h-11 text-base" placeholder="e.g. Sara, manager" autoComplete="name" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Phone {method === "phone_call" ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}</span>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} required={method === "phone_call"} maxLength={30} type="tel" className="h-11 text-base" autoComplete="tel" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Business email {method === "business_email" ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}</span>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} required={method === "business_email"} maxLength={200} type="email" className="h-11 text-base" autoComplete="email" />
      </label>
      {method === "document" && (
        <ProofPhoto value={doc} onChange={setDoc} required label="Document photo" hint="Stored privately: only BrewPick admins can open it. Location data in the photo is removed." />
      )}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Anything else? <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-12 w-full text-base" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send claim"}
      </Button>
    </form>
  );
}
