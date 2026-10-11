import { NextResponse } from "next/server";
import { ANON, dbAs } from "@/lib/db";
import { listPaymentMethods } from "@/lib/deals/repo";

// Reference list of banks, wallets and apps that unlock deals (names only).
export async function GET() {
  const methods = await dbAs(ANON, (tx) => listPaymentMethods(tx));
  return NextResponse.json({ methods }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
