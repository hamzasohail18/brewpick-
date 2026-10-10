import type { Metadata } from "next";
import { dbAs } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { CSV_TYPES } from "@/lib/pipeline/csv-import";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import · BrewPick admin" };

export default async function ImportPage() {
  const admin = await requireAdmin("/admin/import");
  // Only human-entry sources make sense for a spreadsheet someone typed up.
  const sources = await dbAs(admin, (tx) =>
    tx.query<{ slug: string; name: string }>(
      `select slug, name from sources
        where is_active and kind in ('manual_admin', 'field_capture', 'delivery_app_manual', 'social_manual', 'owner_portal')
        order by name`,
    ),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import CSV</h1>
        <p className="text-sm text-muted-foreground">
          Rows are checked and compared with live data, then wait in the review queue. Unchanged rows just refresh
          &ldquo;last verified&rdquo;.
        </p>
      </div>
      <ImportForm sources={sources} types={Object.entries(CSV_TYPES).map(([value, t]) => ({ value, label: t.label }))} />
      <section aria-labelledby="columns" className="space-y-3 text-sm">
        <h2 id="columns" className="text-base font-semibold">
          Columns
        </h2>
        {Object.entries(CSV_TYPES).map(([key, t]) => (
          <div key={key} className="rounded-lg border bg-card p-3">
            <div className="font-medium">
              {t.label}{" "}
              <a href={`/templates/${key}.csv`} download className="ms-2 text-xs font-normal underline underline-offset-4">
                Download template
              </a>
            </div>
            <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
              {t.columns.map((c) => (t.required.includes(c as never) ? `${c}*` : c)).join(", ")}
            </p>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          * required. Prices accept &ldquo;Rs. 1,250/-&rdquo; style values; sizes accept &ldquo;Large&rdquo;, &ldquo;12 oz&rdquo; or
          &ldquo;350ml&rdquo;; yes/no columns accept yes, no or blank (unknown).
        </p>
      </section>
    </div>
  );
}
