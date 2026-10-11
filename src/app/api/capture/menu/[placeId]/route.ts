import { NextResponse } from "next/server";
import { ANON, dbAs } from "@/lib/db";
import { canCapture, getActor } from "@/lib/auth/session";

/** Current published dine-in menu, used to prefill Menu Capture rows. */
export async function GET(_req: Request, ctx: RouteContext<"/api/capture/menu/[placeId]">) {
  if (!canCapture(await getActor())) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { placeId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(placeId)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const items = await dbAs(ANON, (tx) =>
    tx.query<{ name: string; size: string; volume_ml: number | null; price_pkr: number; temperature: string }>(
      `select display_name as name, size_label as size, volume_ml, price_pkr, temperature
         from v_current_menu where place_id = $1 and channel = 'dine_in'
        order by display_name, volume_ml nulls last`,
      [placeId],
    ),
  );
  return NextResponse.json({ items });
}
