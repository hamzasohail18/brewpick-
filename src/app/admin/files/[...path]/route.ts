import { getActor } from "@/lib/auth/session";
import { readUpload } from "@/lib/uploads";

// Private uploads (owner-claim documents). Admins only; never cached by shared caches.
export async function GET(_req: Request, ctx: RouteContext<"/admin/files/[...path]">) {
  const actor = await getActor();
  if (actor.kind !== "user" || !actor.isAdmin) return new Response("Not found", { status: 404 });
  const { path } = await ctx.params;
  if (!path.at(-1)?.endsWith(".jpg")) return new Response("Not found", { status: 404 });
  const bytes = await readUpload(path, "private");
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
