import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { NEW_SOURCE_DEFAULTS } from "../form-defaults";
import { SourceForm } from "../source-form";

export const metadata: Metadata = { title: "Add source · BrewPick admin" };

export default async function NewSourcePage() {
  await requireAdmin("/admin/sources/new");
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/sources" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All sources
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add source</h1>
        <p className="text-sm text-muted-foreground">
          New sources start as &ldquo;Needs review&rdquo;. Collectors can&apos;t run until the terms are reviewed and recorded.
        </p>
      </div>
      <SourceForm id={null} defaults={NEW_SOURCE_DEFAULTS} />
    </div>
  );
}
