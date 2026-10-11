import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { createReport, ReportInput } from "@/lib/community/actions";
import { SubmissionRejected } from "@/lib/community/submissions";

/** "Report a problem" with a place or deal. Runs as the user (RLS own_insert). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const input = ReportInput.safeParse(await req.json().catch(() => null));
  if (!input.success) return badRequest("Choose what's wrong.");
  try {
    const id = await dbAs(actor, (tx) => createReport(tx, actor.userId, input.data));
    return json({ id }, 201);
  } catch (e) {
    if (e instanceof SubmissionRejected) return json({ error: e.message }, e.status);
    throw e;
  }
}
