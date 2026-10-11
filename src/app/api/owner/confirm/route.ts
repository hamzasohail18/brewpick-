import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { dbAs, SERVICE } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { confirmMenu } from "@/lib/community/actions";
import { SubmissionRejected } from "@/lib/community/submissions";

const Body = z.object({ placeId: z.guid() });

/** Owner: "every price on my menu is still right". Ownership (place_owners) is checked in confirmMenu. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest("Unknown place");
  try {
    const summary = await dbAs(SERVICE, (tx) => confirmMenu(tx, actor.userId, body.data.placeId));
    return json(summary);
  } catch (e) {
    if (e instanceof SubmissionRejected) return json({ error: e.message }, e.status);
    throw e;
  }
}
