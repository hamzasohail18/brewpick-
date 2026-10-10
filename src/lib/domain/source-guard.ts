import {
  AUTOMATABLE_STATUSES,
  PLACEHOLDER_CONTACT,
  isHumanEntry,
  reviewDueAt,
  type SourceRow,
} from "./sources";

/** Everything a collector must obey for one source, read from its registry row. */
export interface CollectorPolicy {
  sourceId: string;
  slug: string;
  baseUrl: string;
  rateLimitMs: number;
  userAgent: string;
  cacheAllowed: boolean;
  maxCacheDays: number | null;
}

export type GuardDecision = { allowed: true; reasons: []; policy: CollectorPolicy } | { allowed: false; reasons: string[] };

type GuardInput = Pick<
  SourceRow,
  | "id"
  | "slug"
  | "kind"
  | "base_url"
  | "automation"
  | "automation_notes"
  | "robots_checked_at"
  | "is_active"
  | "rate_limit_seconds"
  | "user_agent"
  | "cache_allowed"
  | "max_cache_days"
>;

export function defaultUserAgent(contactEmail: string | undefined | null): string | null {
  return contactEmail ? `BrewPickLahore/0.1 (+mailto:${contactEmail})` : null;
}

/**
 * The collector guard (Section 8). Pure, so the admin screen can show the same reasons the
 * collector would hit. A source is collectable only if every check passes.
 */
export function checkSource(
  s: GuardInput,
  opts: { now?: Date; contactEmail?: string | null } = {},
): GuardDecision {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];

  if (!s.is_active) reasons.push("Source is inactive.");
  if (isHumanEntry(s.kind)) reasons.push("This is a human-entry source; collectors never run against it.");
  if (!AUTOMATABLE_STATUSES.includes(s.automation))
    reasons.push(`Automation status is "${s.automation}"; it must be "allowed" or "allowed_with_conditions".`);
  if (!s.automation_notes?.trim()) reasons.push("No review notes recorded (robots.txt / terms / licence).");
  if (!s.robots_checked_at) reasons.push("The robots.txt / terms review date is missing.");
  else if (reviewDueAt(s.robots_checked_at) < now)
    reasons.push(`The review is overdue (last reviewed ${s.robots_checked_at.toISOString().slice(0, 10)}); re-review every 6 months.`);
  if (!s.base_url) reasons.push("No base URL set.");

  const userAgent = s.user_agent ?? defaultUserAgent(opts.contactEmail);
  if (!userAgent) reasons.push("No User-Agent: set one on the source or COLLECTOR_CONTACT_EMAIL.");
  else if (userAgent.includes(PLACEHOLDER_CONTACT)) reasons.push("The User-Agent still has the placeholder contact address.");

  if (reasons.length > 0) return { allowed: false, reasons };
  return {
    allowed: true,
    reasons: [],
    policy: {
      sourceId: s.id,
      slug: s.slug,
      baseUrl: s.base_url!,
      rateLimitMs: Math.max(1, Number(s.rate_limit_seconds)) * 1000,
      userAgent: userAgent!,
      cacheAllowed: s.cache_allowed,
      maxCacheDays: s.max_cache_days,
    },
  };
}

export class CollectorBlockedError extends Error {
  constructor(
    readonly slug: string,
    readonly reasons: string[],
  ) {
    super(`Collector blocked for source "${slug}":\n- ${reasons.join("\n- ")}`);
    this.name = "CollectorBlockedError";
  }
}

export function assertCollectable(s: GuardInput, opts?: { now?: Date; contactEmail?: string | null }): CollectorPolicy {
  const decision = checkSource(s, opts);
  if (!decision.allowed) throw new CollectorBlockedError(s.slug, decision.reasons);
  return decision.policy;
}
