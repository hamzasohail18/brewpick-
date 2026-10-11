"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { dbAs } from "@/lib/db";
import { archiveDeal, decideClaim, resolveReport, resolveSubmission } from "@/lib/community/actions";
import { SubmissionRejected } from "@/lib/community/submissions";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

async function run(tab: string, fn: (adminId: string, admin: Awaited<ReturnType<typeof requireAdmin>>) => Promise<void>) {
  const admin = await requireAdmin(`/admin/moderation?tab=${tab}`);
  let error: string | null = null;
  try {
    await fn(admin.userId, admin);
  } catch (e) {
    if (e instanceof SubmissionRejected) error = e.message;
    else throw e;
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/moderation?tab=${tab}${error ? `&error=${encodeURIComponent(error)}` : "&done=1"}`);
}

export async function reportAction(f: FormData) {
  await run("reports", (id, admin) =>
    dbAs(admin, (tx) => resolveReport(tx, id, str(f, "id"), str(f, "outcome") === "dismissed" ? "dismissed" : "resolved", str(f, "note"))),
  );
}

export async function claimAction(f: FormData) {
  await run("claims", (id, admin) => dbAs(admin, (tx) => decideClaim(tx, id, str(f, "id"), str(f, "decision") === "approve", str(f, "note"))));
}

export async function dealAction(f: FormData) {
  await run("deals", (id, admin) => dbAs(admin, (tx) => archiveDeal(tx, id, str(f, "id"), str(f, "note"))));
}

export async function submissionAction(f: FormData) {
  await run("submissions", (id, admin) => dbAs(admin, (tx) => resolveSubmission(tx, id, str(f, "id"), str(f, "decision") === "accept", str(f, "note"))));
}
