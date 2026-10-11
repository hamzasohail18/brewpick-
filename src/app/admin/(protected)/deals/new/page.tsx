import type { Metadata } from "next";
import { dbAs } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { MANUAL_DEAL_SOURCE_KINDS } from "@/lib/admin/manual-deal";
import { karachiDate } from "@/lib/pipeline/normalize";
import { DealForm } from "./deal-form";

export const metadata: Metadata = { title: "Add a deal · BrewPick admin" };

export default async function NewDealPage() {
  const admin = await requireAdmin("/admin/deals/new");
  const data = await dbAs(admin, async (tx) => ({
    sources: await tx.query<{ slug: string; name: string; kind: string; base_url: string | null }>(
      // The fictional sample-data source is for seeded test rows only, never for hand entry.
      "select slug, name, kind::text, base_url from sources where is_active and kind = any($1::source_kind[]) and slug <> 'sample-data' order by kind, name",
      [MANUAL_DEAL_SOURCE_KINDS],
    ),
    brands: await tx.query<{ id: string; name: string; is_sample: boolean }>("select id, name, is_sample from brands order by name"),
    places: await tx.query<{ id: string; name: string; branch_name: string | null; is_sample: boolean }>(
      "select id, name, branch_name, is_sample from places where status = 'published' order by name, branch_name",
    ),
    methods: await tx.query<{ name: string; kind: string }>("select distinct name, kind::text from payment_methods order by kind, name"),
  }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a deal</h1>
        <p className="text-sm text-muted-foreground">
          For offers read off a bank&rsquo;s offer page, an official Instagram/Facebook post or a delivery app. Copy only what the
          source states (no guessed dates). It goes to the review queue like everything else.
        </p>
      </div>
      <DealForm {...data} today={karachiDate()} />
    </div>
  );
}
