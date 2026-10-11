import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { ANON, dbAs } from "@/lib/db";
import { listAreas } from "@/lib/explore/repo";
import { ProfileApp } from "./profile-app";

export const metadata: Metadata = { title: "Profile · BrewPick Lahore" };

export default async function ProfilePage() {
  const actor = await getActor();
  const areas = await dbAs(ANON, (tx) => listAreas(tx));
  return <ProfileApp signedIn={actor.kind === "user"} email={actor.kind === "user" ? (actor.email ?? null) : null} areas={areas} />;
}
