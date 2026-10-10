import { z } from "zod";

// Mirrors the Postgres enums in supabase/migrations/*_schema.sql.
export const SOURCE_KINDS = [
  "open_data_api",
  "official_api",
  "cafe_website",
  "cafe_menu_file",
  "bank_offer_page",
  "social_official_api",
  "social_manual",
  "delivery_app_manual",
  "field_capture",
  "owner_portal",
  "community_submission",
  "reference_dataset",
  "manual_admin",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const AUTOMATION_STATUSES = ["allowed", "allowed_with_conditions", "not_allowed", "unknown_review_required"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["verified", "community_reported", "estimated"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "partial"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses that let a collector run. */
export const AUTOMATABLE_STATUSES: readonly AutomationStatus[] = ["allowed", "allowed_with_conditions"];

/** Sources people type data into. There is nothing to crawl, so collectors never run against them. */
export const HUMAN_ENTRY_KINDS: readonly SourceKind[] = [
  "social_manual",
  "delivery_app_manual",
  "field_capture",
  "owner_portal",
  "community_submission",
  "manual_admin",
];

/** Section 8.1: re-review every source every 6 months. */
export const REREVIEW_MONTHS = 6;

/** Placeholder contact domain; collectors refuse to identify themselves with it. */
export const PLACEHOLDER_CONTACT = "brewpick.example";

export interface SourceRow {
  id: string;
  slug: string;
  name: string;
  kind: SourceKind;
  base_url: string | null;
  place_id: string | null;
  automation: AutomationStatus;
  automation_notes: string | null;
  tos_url: string | null;
  robots_checked_at: Date | null;
  license: string | null;
  attribution_required: boolean;
  attribution_text: string | null;
  cache_allowed: boolean;
  max_cache_days: number | null;
  rate_limit_seconds: number;
  user_agent: string | null;
  default_confidence: ConfidenceLevel;
  check_interval_days: number;
  last_checked_at: Date | null;
  next_check_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SourceRunRow {
  id: string;
  source_id: string;
  started_at: Date;
  finished_at: Date | null;
  status: RunStatus;
  records_found: number | null;
  records_staged: number | null;
  error_message: string | null;
  raw_snapshot_url: string | null;
}

export const isHumanEntry = (kind: SourceKind) => HUMAN_ENTRY_KINDS.includes(kind);

export function reviewDueAt(reviewedAt: Date): Date {
  const d = new Date(reviewedAt);
  d.setMonth(d.getMonth() + REREVIEW_MONTHS);
  return d;
}

export type ReviewState = "not_applicable" | "needs_review" | "overdue" | "ok";

/** What the registry screen shows in its "review" column. */
export function reviewState(s: Pick<SourceRow, "kind" | "automation" | "robots_checked_at">, now = new Date()): ReviewState {
  if (isHumanEntry(s.kind)) return "not_applicable";
  if (s.automation === "unknown_review_required" || !s.robots_checked_at) return "needs_review";
  if (reviewDueAt(s.robots_checked_at) < now) return "overdue";
  return "ok";
}

// ---------- form schema ----------

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();
const optionalUrl = optionalText.refine((v) => v === null || /^https?:\/\//.test(v), "Must start with http:// or https://");
const optionalInt = z.union([z.literal(""), z.coerce.number().int().positive()]).transform((v) => (v === "" ? null : v));
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const SourceFormSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes only"),
    name: z.string().trim().min(2, "Required"),
    kind: z.enum(SOURCE_KINDS),
    base_url: optionalUrl,
    place_id: optionalText.refine((v) => v === null || z.uuid().safeParse(v).success, "Must be a place UUID"),
    automation: z.enum(AUTOMATION_STATUSES),
    automation_notes: optionalText,
    tos_url: optionalUrl,
    robots_checked_at: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          ctx.addIssue({ code: "custom", message: "Not a valid date" });
          return z.NEVER;
        }
        return d;
      })
      .nullable(),
    license: optionalText,
    attribution_required: checkbox,
    attribution_text: optionalText,
    cache_allowed: checkbox,
    max_cache_days: optionalInt,
    rate_limit_seconds: z.coerce.number().min(1, "At least 1 second between requests").max(3600),
    user_agent: optionalText,
    default_confidence: z.enum(CONFIDENCE_LEVELS),
    check_interval_days: z.coerce.number().int().min(1).max(365),
    is_active: checkbox,
  })
  .superRefine((s, ctx) => {
    // Section 8.3: notes and review date are required before a crawlable source can be opened up.
    if (AUTOMATABLE_STATUSES.includes(s.automation) && !isHumanEntry(s.kind)) {
      if (!s.automation_notes)
        ctx.addIssue({ code: "custom", path: ["automation_notes"], message: "Record what robots.txt / ToS / licence say before allowing automation" });
      if (!s.robots_checked_at)
        ctx.addIssue({ code: "custom", path: ["robots_checked_at"], message: "Set the date you reviewed robots.txt and the terms" });
    }
    if (s.robots_checked_at && s.robots_checked_at > new Date(Date.now() + 86_400_000))
      ctx.addIssue({ code: "custom", path: ["robots_checked_at"], message: "Review date can't be in the future" });
    if (s.attribution_required && !s.attribution_text)
      ctx.addIssue({ code: "custom", path: ["attribution_text"], message: "Attribution text is required when attribution is required" });
    if (s.user_agent?.includes(PLACEHOLDER_CONTACT))
      ctx.addIssue({ code: "custom", path: ["user_agent"], message: "Use a real contact address, or leave blank to use COLLECTOR_CONTACT_EMAIL" });
  });

export type SourceFormValues = z.infer<typeof SourceFormSchema>;
