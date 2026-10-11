"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { dbAs } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { MAX_PROOF_BYTES } from "@/lib/http";
import { ManualDealForm, manualDealFields, stageManualDeal } from "@/lib/admin/manual-deal";

export type ManualDealState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: ReturnType<typeof manualDealFields>;
  n?: number;
};

async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function addDealAction(prev: ManualDealState, fd: FormData): Promise<ManualDealState> {
  const n = (prev.n ?? 0) + 1;
  const admin = await requireAdmin("/admin/deals/new");
  const values = manualDealFields(fd);
  const parsed = ManualDealForm.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return { n, error: "Check the highlighted fields.", fieldErrors, values };
  }

  let proofUrl: string | null = null;
  const file = fd.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PROOF_BYTES) return { n, error: "The screenshot is larger than 5 MB.", values };
    const { isJpeg, saveProofJpeg } = await import("@/lib/uploads");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isJpeg(bytes)) return { n, error: "Screenshots must be JPEG.", values };
    proofUrl = `${await origin()}${await saveProofJpeg(bytes)}`;
  }

  const out = await dbAs(admin, (tx) => stageManualDeal(tx, admin.userId, parsed.data, proofUrl));
  if ("error" in out) return { n, error: out.error, values };
  revalidatePath("/admin/review");
  revalidatePath("/admin", "layout");
  return {
    n,
    ok: true,
    message: out.staged ? "Sent to the review queue." : "Matches the live deal exactly; marked as re-checked.",
  };
}
