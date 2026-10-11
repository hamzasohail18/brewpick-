import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { addFavorites, removeFavorite } from "@/lib/profile/repo";

const Body = z.object({ add: z.array(z.uuid()).max(500).default([]), remove: z.uuid().optional() });

/** { add: [placeId, ...] } adds (also used to merge favourites saved on the phone); { remove: placeId } removes one. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid favourites update");
  await dbAs(actor, async (tx) => {
    await addFavorites(tx, actor.userId, parsed.data.add);
    if (parsed.data.remove) await removeFavorite(tx, actor.userId, parsed.data.remove);
  });
  return json({ ok: true });
}
