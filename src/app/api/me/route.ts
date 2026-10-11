import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { badRequest, forbidden, json, sameOrigin, signedOut } from "@/lib/http";
import { getMe, ProfileUpdate, updateProfile } from "@/lib/profile/repo";

// The signed-in user's profile, favourites and synced cards. Signed out: { signedIn: false }.
export async function GET() {
  const actor = await getActor();
  if (actor.kind !== "user") return json({ signedIn: false });
  const me = await dbAs(actor, (tx) => getMe(tx, actor.userId));
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
