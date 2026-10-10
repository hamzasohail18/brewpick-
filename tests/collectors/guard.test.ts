import { describe, expect, test } from "vitest";
import { assertCollectable, checkSource, CollectorBlockedError } from "@/lib/domain/source-guard";
import { reviewState, SourceFormSchema, type SourceRow } from "@/lib/domain/sources";

const NOW = new Date("2026-10-12T00:00:00Z");

const reviewed: SourceRow = {
  id: "s1",
  slug: "cafe-website-test",
  name: "Test cafe website",
  kind: "cafe_website",
  base_url: "https://cafe.example.com",
  place_id: null,
  automation: "allowed_with_conditions",
  automation_notes: "robots.txt allows /menu; ToS silent on automation. Reviewed by admin.",
  tos_url: null,
  robots_checked_at: new Date("2026-09-01T00:00:00Z"),
  license: null,
  attribution_required: false,
  attribution_text: null,
  cache_allowed: true,
  max_cache_days: null,
  rate_limit_seconds: 5,
  user_agent: "BrewPickLahore/0.1 (+mailto:ops@brewpick.pk)",
  default_confidence: "community_reported",
  check_interval_days: 14,
  last_checked_at: null,
  next_check_at: null,
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
};

describe("collector guard", () => {
  test("allows a reviewed, active source and returns its policy", () => {
    const d = checkSource(reviewed, { now: NOW });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.policy).toMatchObject({ rateLimitMs: 5000, userAgent: reviewed.user_agent, cacheAllowed: true });
  });

  test.each([
    ["not_allowed", /Automation status is "not_allowed"/],
    ["unknown_review_required", /Automation status is "unknown_review_required"/],
  ] as const)("blocks automation = %s", (automation, reason) => {
    const d = checkSource({ ...reviewed, automation }, { now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reasons.join("\n")).toMatch(reason);
  });

  test("blocks human-entry sources even when allowed", () => {
    const d = checkSource({ ...reviewed, kind: "social_manual", automation: "allowed" }, { now: NOW });
    expect(d.reasons.join("\n")).toMatch(/human-entry/);
  });

  test("blocks inactive sources, missing notes and missing review date", () => {
    const d = checkSource({ ...reviewed, is_active: false, automation_notes: " ", robots_checked_at: null }, { now: NOW });
    expect(d.reasons).toHaveLength(3);
  });

  test("blocks when the 6-month re-review is overdue", () => {
    const d = checkSource({ ...reviewed, robots_checked_at: new Date("2026-03-01T00:00:00Z") }, { now: NOW });
    expect(d.reasons.join("\n")).toMatch(/overdue/);
  });

  test("refuses the seeded placeholder contact and falls back to COLLECTOR_CONTACT_EMAIL", () => {
    const placeholder = { ...reviewed, user_agent: "BrewPickLahore/0.1 (+mailto:data@brewpick.example)" };
    expect(checkSource(placeholder, { now: NOW }).allowed).toBe(false);
    const noUa = { ...reviewed, user_agent: null };
    expect(checkSource(noUa, { now: NOW }).allowed).toBe(false);
    const d = checkSource(noUa, { now: NOW, contactEmail: "ops@brewpick.pk" });
    expect(d.allowed && d.policy.userAgent).toBe("BrewPickLahore/0.1 (+mailto:ops@brewpick.pk)");
  });

  test("assertCollectable throws with every reason", () => {
    expect(() => assertCollectable({ ...reviewed, automation: "not_allowed", base_url: null }, { now: NOW })).toThrow(
      CollectorBlockedError,
    );
  });
});

describe("review state", () => {
  test.each([
    [{ kind: "manual_admin", automation: "allowed", robots_checked_at: null }, "not_applicable"],
    [{ kind: "bank_offer_page", automation: "unknown_review_required", robots_checked_at: null }, "needs_review"],
    [{ kind: "bank_offer_page", automation: "not_allowed", robots_checked_at: new Date("2026-01-01") }, "overdue"],
    [{ kind: "bank_offer_page", automation: "allowed", robots_checked_at: new Date("2026-09-01") }, "ok"],
  ] as const)("%o -> %s", (s, expected) => {
    expect(reviewState(s, NOW)).toBe(expected);
  });
});

describe("source form validation", () => {
  const form = {
    slug: "bank-offers-test",
    name: "Test bank",
    kind: "bank_offer_page",
    base_url: "https://bank.example.com",
    place_id: "",
    automation: "allowed",
    automation_notes: "",
    tos_url: "",
    robots_checked_at: "",
    license: "",
    attribution_text: "",
    max_cache_days: "",
    rate_limit_seconds: "5",
    user_agent: "",
    default_confidence: "community_reported",
    check_interval_days: "1",
    is_active: "on",
  };

  test("allowing automation requires notes and a review date", () => {
    const r = SourceFormSchema.safeParse(form);
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["automation_notes", "robots_checked_at"]));
  });

  test("passes once the review is recorded; blanks become null and checkboxes booleans", () => {
    const r = SourceFormSchema.parse({ ...form, automation_notes: "Reviewed ToS", robots_checked_at: "2026-10-01" });
    expect(r).toMatchObject({ tos_url: null, max_cache_days: null, is_active: true, cache_allowed: false, rate_limit_seconds: 5 });
    expect(r.robots_checked_at).toBeInstanceOf(Date);
  });

  test("human-entry sources can be allowed without a crawl review", () => {
    expect(SourceFormSchema.safeParse({ ...form, kind: "manual_admin" }).success).toBe(true);
  });
});
