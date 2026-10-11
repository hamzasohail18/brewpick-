import { readUpload } from "@/lib/uploads";

// Proof photos (menu boards). Metadata is stripped at upload, so they're safe to serve publicly.
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[...path]">) {
  const { path } = await ctx.params;
  if (!path.at(-1)?.endsWith(".jpg")) return new Response("Not found", { status: 404 });
  const bytes = await readUpload(path);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
