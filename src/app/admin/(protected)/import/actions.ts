"use server";

import { revalidatePath } from "next/cache";
import { dbAs } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { CSV_TYPES, importCsv, type CsvImportResult, type CsvType } from "@/lib/pipeline/csv-import";

export type ImportState = { error?: string; result?: CsvImportResult; fileName?: string };

const MAX_BYTES = 2 * 1024 * 1024;

export async function importAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const admin = await requireAdmin("/admin/import");
  const type = String(formData.get("type") ?? "") as CsvType;
  const sourceSlug = String(formData.get("source") ?? "");
  const file = formData.get("file");

  if (!(type in CSV_TYPES)) return { error: "Choose what the file contains." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { error: "The file is larger than 2 MB. Split it up." };
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return { error: "That isn't a .csv file." };

  const result = await dbAs(admin, async (tx) => {
    const [source] = await tx.query<{ id: string }>("select id from sources where slug = $1", [sourceSlug]);
    if (!source) return null;
    return importCsv(tx, { type, csv: await file.text(), sourceId: source.id });
  });
  if (!result) return { error: "Unknown source." };

  revalidatePath("/admin/review");
  revalidatePath("/admin", "layout");
  return { result, fileName: file.name };
}
