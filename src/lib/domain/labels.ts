import type { AutomationStatus, ConfidenceLevel, ReviewState, RunStatus, SourceKind } from "./sources";

export const KIND_LABELS: Record<SourceKind, string> = {
  open_data_api: "Open data API",
  official_api: "Official API",
  cafe_website: "Cafe website",
  cafe_menu_file: "Cafe menu file",
  bank_offer_page: "Bank offer page",
  social_official_api: "Social (official API)",
  social_manual: "Social (manual)",
  delivery_app_manual: "Delivery app (manual)",
  field_capture: "Field capture",
  owner_portal: "Owner portal",
  community_submission: "Community submission",
  reference_dataset: "Reference dataset",
  manual_admin: "Manual admin",
};

export const AUTOMATION_LABELS: Record<AutomationStatus, string> = {
  allowed: "Allowed",
  allowed_with_conditions: "Allowed with conditions",
  not_allowed: "Not allowed",
  unknown_review_required: "Needs review",
};

export const REVIEW_LABELS: Record<ReviewState, string> = {
  not_applicable: "Manual entry",
  needs_review: "Not reviewed",
  overdue: "Re-review overdue",
  ok: "Reviewed",
};

export const RUN_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  partial: "Partial",
};

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  verified: "Verified",
  community_reported: "Community-reported",
  estimated: "Estimated",
};

const dateFmt = new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" });

export const formatDate = (d: Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatDateTime = (d: Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "—");
