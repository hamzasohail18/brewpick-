import { BadgeCheck, FlaskConical, Calculator, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n";
import type { ConfidenceLevel } from "@/lib/domain/sources";
import { checkedAgo } from "@/lib/explore/format";

const CONFIDENCE_STYLE: Record<ConfidenceLevel, { icon: typeof BadgeCheck; className: string }> = {
  verified: { icon: BadgeCheck, className: "border-success/40 bg-success/10 text-success" },
  community_reported: { icon: Users, className: "border-border bg-secondary text-secondary-foreground" },
  estimated: { icon: Calculator, className: "border-warning/50 bg-warning/15 text-foreground" },
};

/** Verified / Community-reported / Estimated, optionally with "checked N days ago" (Section 3B). */
export function ConfidenceBadge({
  level,
  checkedAt,
  className,
  wrap = false,
}: {
  level: ConfidenceLevel;
  checkedAt?: string | null;
  className?: string;
  /** Allow the label to wrap (narrow table cells). */
  wrap?: boolean;
}) {
  const t = getT();
  const { icon: Icon, className: tone } = CONFIDENCE_STYLE[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        wrap ? "break-words" : "whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {t(`confidence.${level}`)}
      {checkedAt !== undefined && <span className="font-normal opacity-80">· {checkedAgo(checkedAt)}</span>}
    </span>
  );
}

/** Shown on every fictional record (Section 9). */
export function SampleBadge({ className, wrap = false }: { className?: string; wrap?: boolean }) {
  const t = getT();
  return (
    <span
      title={t("badge.sampleHint")}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-warning bg-warning/15 px-2 py-0.5 text-xs font-semibold text-foreground",
        wrap ? "break-words" : "whitespace-nowrap",
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-3" />
      {t("badge.sample")}
      <span className="sr-only">: {t("badge.sampleHint")}</span>
    </span>
  );
}

export function Tone({ tone, children, className }: { tone: "ok" | "warn" | "bad" | "neutral"; children: React.ReactNode; className?: string }) {
  const dot = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive", neutral: "bg-muted-foreground" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {children}
    </span>
  );
}
