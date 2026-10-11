import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { voteOnDeal } from "@/lib/community/actions";
import { SubmissionRejected } from "@/lib/community/submissions";

const Body = z.object({ accurate: z.boolean().nullable() });

/** "Did this deal work for you?" { accurate: true | false | null (take back) }. Runs as the user (RLS). */
export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/vote">) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const { id } = await ctx.params;
  const dealId = z.guid().safeParse(id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!dealId.success || !body.success) return badRequest("Invalid vote");
  try {
    const counts = await dbAs(actor, (tx) => voteOnDeal(tx, actor.userId, dealId.data, body.data.accurate));
    return json(counts);
  } catch (e) {
    if (e instanceof SubmissionRejected) return json({ error: e.message }, e.status);
    throw e;
  }
}
