import type { SourceRow } from "@/lib/domain/sources";
import type { SourceFormDefaults } from "./source-form";

/** New sources start closed: unknown_review_required until someone reviews them (Section 8.1). */
export const NEW_SOURCE_DEFAULTS: SourceFormDefaults = {
  kind: "cafe_website",
  automation: "unknown_review_required",
  rate_limit_seconds: "5",
  check_interval_days: "14",
  default_confidence: "community_reported",
  cache_allowed: "on",
  is_active: "on",
};

export function toFormDefaults(s: SourceRow): SourceFormDefaults {
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const on = (b: boolean) => (b ? "on" : "");
  return {
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    base_url: str(s.base_url),
    place_id: str(s.place_id),
    automation: s.automation,
    automation_notes: str(s.automation_notes),
    tos_url: str(s.tos_url),
    // <input type="date"> wants YYYY-MM-DD in local (Asia/Karachi) terms.
    robots_checked_at: s.robots_checked_at
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(s.robots_checked_at))
      : "",
    license: str(s.license),
    attribution_required: on(s.attribution_required),
    attribution_text: str(s.attribution_text),
    cache_allowed: on(s.cache_allowed),
    max_cache_days: str(s.max_cache_days),
    rate_limit_seconds: str(s.rate_limit_seconds),
    user_agent: str(s.user_agent),
    default_confidence: s.default_confidence,
    check_interval_days: str(s.check_interval_days),
    is_active: on(s.is_active),
  };
}
