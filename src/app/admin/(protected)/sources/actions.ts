"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSource, queueRun, saveSource } from "@/lib/admin/sources-repo";
import { requireAdmin } from "@/lib/auth/session";
import { checkSource } from "@/lib/domain/source-guard";
import { SourceFormSchema } from "@/lib/domain/sources";

export type SourceFormState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Echo of what was submitted, so the form keeps the user's input after a failed save. */
  values?: Record<string, string>;
  /** Submission counter; the form remounts on change so selects pick up `values` after React's form reset. */
  n?: number;
};

function pgErrorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

export async function saveSourceAction(prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const n = (prev.n ?? 0) + 1;
  const id = (formData.get("id") as string | null) || null;
  const admin = await requireAdmin(id ? `/admin/sources/${id}` : "/admin/sources/new");

  const raw = Object.fromEntries([...formData.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const parsed = SourceFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
    return { n, error: "Fix the highlighted fields.", fieldErrors, values: raw };
  }

  let savedId: string;
  try {
    savedId = await saveSource(admin, id, parsed.data);
  } catch (e) {
    const code = pgErrorCode(e);
    if (code === "23505") return { n, error: "That slug is already used.", fieldErrors: { slug: ["Already used"] }, values: raw };
    if (code === "23514") return { n, error: `The database rejected this: ${(e as Error).message}`, values: raw };
    if (code === "23503") return { n, error: "That place ID doesn't exist.", fieldErrors: { place_id: ["Unknown place"] }, values: raw };
    throw e;
  }

  revalidatePath("/admin/sources");
  revalidatePath("/", "layout"); // attribution footer reads the registry
  if (!id) redirect(`/admin/sources/${savedId}?created=1`);
  return { n, ok: true, message: "Saved." };
}

export type RunState = { ok?: boolean; message?: string; reasons?: string[] };

export async function runNowAction(_prev: RunState, formData: FormData): Promise<RunState> {
  const id = String(formData.get("id") ?? "");
  const admin = await requireAdmin(`/admin/sources/${id}`);
  const found = await getSource(admin, id);
  if (!found) return { message: "Source not found." };

  // Re-check here: the button state on the page may be stale.
  const decision = checkSource(found.source, { contactEmail: process.env.COLLECTOR_CONTACT_EMAIL });
  if (!decision.allowed) return { message: "Blocked by the collector guard.", reasons: decision.reasons };

  try {
    await queueRun(admin, id);
  } catch (e) {
    if (pgErrorCode(e) === "23514") return { message: "Blocked by the database guard.", reasons: [(e as Error).message] };
    throw e;
  }
  revalidatePath(`/admin/sources/${id}`);
  revalidatePath("/admin/sources");
  return { ok: true, message: "Run queued. The collector worker will pick it up." };
}
