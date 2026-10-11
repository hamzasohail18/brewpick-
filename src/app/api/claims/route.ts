import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, saveProofFromForm, signedOut } from "@/lib/http";
import { ClaimInput, createClaim } from "@/lib/community/actions";
import { SubmissionRejected } from "@/lib/community/submissions";

/** "Claim this place". Multipart: place_id, claim (JSON), document (optional JPEG). Runs as the user. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Expected a form upload");
  const placeId = z.guid().safeParse(form.get("place_id"));
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form.get("claim") ?? ""));
  } catch {
    // handled below
  }
  const input = ClaimInput.safeParse(raw);
  if (!placeId.success) return badRequest("Unknown place");
  if (!input.success) return badRequest(input.error.issues[0]?.message ?? "Some details are missing.");
  const saved = await saveProofFromForm(req, form, "document", "private"); // identity documents: admins only
  if ("error" in saved) return json({ error: saved.error }, saved.status);
  try {
    const id = await dbAs(actor, (tx) => createClaim(tx, actor.userId, placeId.data, input.data, saved.url));
    return json({ id }, 201);
  } catch (e) {
    if (e instanceof SubmissionRejected) return json({ error: e.message }, e.status);
    throw e;
  }
}
