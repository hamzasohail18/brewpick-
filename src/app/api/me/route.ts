import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { getMe, ProfileUpdate, updateProfile } from "@/lib/profile/repo";
import { myDealVotes, ownedPlaces } from "@/lib/community/actions";

// The signed-in user's profile, favourites and synced cards. Signed out: { signedIn: false }.
export async function GET() {
  const actor = await getActor();
  if (actor.kind !== "user") return json({ signedIn: false });
  const me = await dbAs(actor, async (tx) => ({
    ...(await getMe(tx, actor.userId)),
    dealVotes: await myDealVotes(tx, actor.userId),
    ownsPlaces: (await ownedPlaces(tx, actor.userId)).length,
  }));
  return json({ signedIn: true, email: actor.email ?? null, ...me });
}

export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  const parsed = ProfileUpdate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid profile update");
  await dbAs(actor, (tx) => updateProfile(tx, actor.userId, parsed.data));
  return json({ ok: true });
}
