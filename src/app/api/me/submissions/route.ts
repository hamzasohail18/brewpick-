import { getActor } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { json, signedOut } from "@/lib/http";
import { mySubmissions } from "@/lib/community/submissions";

export async function GET() {
  const actor = await getActor();
  if (actor.kind !== "user") return signedOut();
  return json({ submissions: await dbAs(actor, (tx) => mySubmissions(tx, actor.userId)) });
}
