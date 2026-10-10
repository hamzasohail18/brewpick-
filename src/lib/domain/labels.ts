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

/** Review-queue flags (validator + diff engine). Unknown flags fall back to the raw key. */
export const FLAG_LABELS: Record<string, { label: string; tone: "warn" | "bad" | "neutral" }> = {
  price_change_over_15pct: { label: "Price change > 15%", tone: "bad" },
  price_out_of_range: { label: "Unusual price", tone: "bad" },
  calories_implausible: { label: "Calories look wrong", tone: "bad" },
  caffeine_high: { label: "High caffeine", tone: "warn" },
  removed_item: { label: "Removed from menu", tone: "bad" },
  outside_lahore: { label: "Outside Lahore", tone: "bad" },
  deal_expired: { label: "Deal already ended", tone: "bad" },
  deal_expires_soon: { label: "Ends within 48 h", tone: "warn" },
  discount_over_50pct: { label: "Discount > 50%", tone: "warn" },
  volume_assumed: { label: "Volume assumed", tone: "neutral" },
  unknown_drink_type: { label: "Unknown drink type", tone: "warn" },
  new_item: { label: "New item", tone: "neutral" },
  new_place: { label: "New place", tone: "neutral" },
  validation_error: { label: "Failed validation", tone: "bad" },
  ocr_low_confidence: { label: "OCR unsure", tone: "warn" },
};

export const ACTION_LABELS = { create: "New", update: "Change", delete: "Removal", reconfirm: "Re-confirm" } as const;

export const TABLE_LABELS: Record<string, string> = {
  item_prices: "Prices",
  places: "Places",
  nutrition_info: "Nutrition",
  deals: "Deals",
  bean_info: "Beans",
};

export function timeAgo(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return "—";
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}
