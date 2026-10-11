import { NextResponse, type NextRequest } from "next/server";
import { dbAs, SERVICE } from "@/lib/db";
import { canCapture, getActor } from "@/lib/auth/session";
import { CaptureRejected, findCapture, processCapture } from "@/lib/capture/process";
import { CaptureSubmission, MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/capture/schema";
import { isJpeg, saveProofJpeg } from "@/lib/uploads";
import { publicOrigin } from "@/lib/http";

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (actor.kind !== "user") return fail(401, "Sign in to submit captures.");
  if (!canCapture(actor)) return fail(403, "Menu Capture is for volunteers and admins.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Expected a multipart form.");
  }

  let json: unknown;
  try {
    json = JSON.parse(String(form.get("capture") ?? ""));
  } catch {
    return fail(400, "Missing capture details.");
  }
  const parsed = CaptureSubmission.safeParse(json);
  if (!parsed.success) {
    return fail(422, "Some details are missing or wrong.", { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  }
  const submission = parsed.data;

  // Already received (offline sync retried): answer without storing the photos again.
  const already = await dbAs(SERVICE, (tx) => findCapture(tx, submission.id));
  if (already) return NextResponse.json(already);

  const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  if (photos.length === 0) return fail(422, "Add a photo of the menu.");
  if (photos.length > MAX_PHOTOS) return fail(422, `At most ${MAX_PHOTOS} photos.`);
  const urls: string[] = [];
  for (const photo of photos) {
    if (photo.size > MAX_PHOTO_BYTES) return fail(413, "A photo is larger than 5 MB.");
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!isJpeg(bytes)) return fail(415, "Photos must be JPEG.");
    try {
      urls.push(`${publicOrigin(req)}${await saveProofJpeg(bytes)}`);
    } catch {
      return fail(415, "A photo couldn't be read.");
    }
  }

  try {
    // Volunteers can't write staging tables directly; the server does it after the checks above.
    const result = await dbAs(SERVICE, (tx) => processCapture(tx, { userId: actor.userId, submission, photoUrls: urls, maxDistanceM: Number(process.env.CAPTURE_MAX_DISTANCE_M) || undefined }));
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof CaptureRejected) return fail(422, e.message);
    throw e;
  }
}
