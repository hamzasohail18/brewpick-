import { cn } from "@/lib/utils";
import { AUTOMATION_LABELS, REVIEW_LABELS, RUN_LABELS } from "@/lib/domain/labels";
import type { AutomationStatus, ReviewState, RunStatus } from "@/lib/domain/sources";

type Tone = "ok" | "warn" | "bad" | "neutral";

const TONES: Record<Tone, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/50 bg-warning/15 text-foreground",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

const DOTS: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  neutral: "bg-muted-foreground",
};

export function StatusBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[tone])} />
      {children}
    </span>
  );
}

const automationTone: Record<AutomationStatus, Tone> = {
  allowed: "ok",
  allowed_with_conditions: "ok",
  not_allowed: "bad",
  unknown_review_required: "warn",
};
export const AutomationBadge = ({ value }: { value: AutomationStatus }) => (
  <StatusBadge tone={automationTone[value]}>{AUTOMATION_LABELS[value]}</StatusBadge>
);

const reviewTone: Record<ReviewState, Tone> = { ok: "ok", needs_review: "warn", overdue: "bad", not_applicable: "neutral" };
export const ReviewBadge = ({ value }: { value: ReviewState }) => (
  <StatusBadge tone={reviewTone[value]}>{REVIEW_LABELS[value]}</StatusBadge>
);

const runTone: Record<RunStatus, Tone> = { succeeded: "ok", partial: "warn", failed: "bad", queued: "neutral", running: "neutral" };
export const RunBadge = ({ value }: { value: RunStatus }) => <StatusBadge tone={runTone[value]}>{RUN_LABELS[value]}</StatusBadge>;
