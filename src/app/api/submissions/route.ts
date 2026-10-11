import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { dbAs, SERVICE } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, saveProofFromForm, signedOut } from "@/lib/http";
import { createSubmission, PROOF_REQUIRED, SubmissionPayload, SubmissionRejected } from "@/lib/community/submissions";

// A correction or new deal from a signed-in user, with an optional (sometimes required) photo.
// Multipart: place_id, payload (JSON), note, photo (JPEG, metadata stripped on save).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Expected a form upload");
  const placeId = z.guid().safeParse(form.get("place_id"));
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    // handled below
  }
  const payload = SubmissionPayload.safeParse(raw);
  if (!placeId.success || !payload.success) return badRequest("Some details are missing or invalid.");
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;

  // Check the photo requirement before writing a file.
  const photo = form.get("photo");
  if (PROOF_REQUIRED[payload.data.type] && !(photo instanceof File && photo.size > 0)) return badRequest("Add a photo as proof.");
  const saved = await saveProofFromForm(req, form);
  if ("error" in saved) return json({ error: saved.error }, saved.status);

  try {
    const result = await dbAs(SERVICE, (tx) =>
      createSubmission(tx, { userId: actor.userId, placeId: placeId.data, payload: payload.data, note, proofUrl: saved.url }),
    );
    return json(result, 201);
  } catch (e) {
    if (e instanceof SubmissionRejected) return json({ error: e.message }, e.status);
    throw e;
  }
}
