export type AttentionState = "blocker" | "review" | "stale" | "info";
export type AttentionLifecycle =
  | "open"
  | "in_progress"
  | "reviewed"
  | "deferred"
  | "resolved"
  | "current"
  | "historical";

export const ATTENTION_STATE_ORDER: Record<AttentionState, number> = {
  blocker: 0,
  review: 1,
  stale: 2,
  info: 3,
};

export const ATTENTION_STATE_LABEL: Record<AttentionState, string> = {
  blocker: "Urgent blocker",
  review: "Required review",
  stale: "Recoverable stale",
  info: "Informational",
};

export const ATTENTION_STATE_CLASS: Record<AttentionState, string> = {
  blocker: "bg-red-500/15 text-red-400",
  review: "bg-amber-500/15 text-amber-500",
  stale: "bg-sky-500/15 text-sky-400",
  info: "bg-muted text-muted-foreground",
};

export function attentionStateForSeverity(
  severity: string,
  lifecycle: AttentionLifecycle = "open",
): AttentionState {
  if (lifecycle === "deferred" || lifecycle === "historical") return "stale";
  if (severity === "urgent" || severity === "error" || severity === "high") return "blocker";
  if (severity === "info" || lifecycle === "resolved") return "info";
  return "review";
}

export function nextActionForAttention(
  state: AttentionState,
  lifecycle: AttentionLifecycle,
): string {
  if (lifecycle === "resolved") return "No action needed";
  if (lifecycle === "deferred") return "Resume or reassign";
  if (lifecycle === "historical") return "Review when convenient";
  if (state === "blocker") return "Act now";
  if (state === "review") return "Review and decide";
  if (state === "stale") return "Recover or close";
  return "Monitor";
}