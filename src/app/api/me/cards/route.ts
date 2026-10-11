import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { setCards } from "@/lib/profile/repo";

const Body = z.object({ ids: z.array(z.number().int().positive()).max(100) });

/** Replace the cards saved on the account (bank/app names only). { ids: [] } removes them all. */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid cards update");
  const ids = await dbAs(actor, (tx) => setCards(tx, actor.userId, parsed.data.ids));
  return json({ ok: true, ids });
}
