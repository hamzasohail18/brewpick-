"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { approveStaged, PublishError, rejectStaged } from "@/lib/pipeline/publish";
import { fromEditableFields } from "@/lib/pipeline/review-format";
import { syncSubmissionForStaged } from "@/lib/community/submissions";

export type ReviewActionState = { error?: string; errors?: string[] };

function nextUrl(formData: FormData, outcome: string) {
  const next = formData.get("next_id");
  return typeof next === "string" && next ? `/admin/review/${next}?done=${outcome}` : `/admin/review?done=${outcome}`;
}

export async function approveAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const id = String(formData.get("id") ?? "");
  const admin = await requireAdmin(`/admin/review/${id}`);

  let edited: unknown;
  if (formData.get("mode") === "edit") {
    const original = JSON.parse(String(formData.get("original") ?? "{}"));
    const submitted = Object.fromEntries(
      [...formData.entries()].filter(([k]) => k.startsWith("f:")).map(([k, v]) => [k.slice(2), String(v)]),
    );
    edited = fromEditableFields(original, submitted);
  }

  try {
    await dbAs(admin, async (tx) => {
      await approveStaged(tx, { id: admin.userId, kind: "admin" }, id, edited);
      await syncSubmissionForStaged(tx, id); // the sender sees their submission go live
    });
  } catch (e) {
    if (e instanceof PublishError) return { error: "Couldn't publish this record.", errors: e.errors };
    throw e;
  }
  revalidatePath("/admin/review");
  revalidatePath("/admin", "layout");
  redirect(nextUrl(formData, "approved"));
}

export async function rejectAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const id = String(formData.get("id") ?? "");
  const admin = await requireAdmin(`/admin/review/${id}`);
  try {
    await dbAs(admin, async (tx) => {
      await rejectStaged(tx, { id: admin.userId, kind: "admin" }, id, String(formData.get("note") ?? ""));
      await syncSubmissionForStaged(tx, id);
    });
  } catch (e) {
    if (e instanceof PublishError) return { error: e.errors.join(" ") };
    throw e;
  }
  revalidatePath("/admin/review");
  revalidatePath("/admin", "layout");
  redirect(nextUrl(formData, "rejected"));
}
