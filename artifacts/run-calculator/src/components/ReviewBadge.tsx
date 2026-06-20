import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { ReviewVerdict } from "@workspace/ai-review";

// Reviewer-AI "second set of eyes" flag. Advisory only — it never blocks
// applying a suggestion, it just warns the user when a second AI pass thinks a
// suggestion is risky (warn) or likely wrong/unsafe (reject). An "ok" verdict or
// a missing verdict (reviewer unavailable / fail-safe) renders nothing.
export default function ReviewBadge({
  review,
  className = "",
}: {
  review?: ReviewVerdict;
  className?: string;
}) {
  if (!review || review.status === "ok") return null;

  const isReject = review.status === "reject";
  const Icon = isReject ? ShieldAlert : AlertTriangle;
  const label = isReject ? "Likely wrong" : "Double-check";
  const cls = isReject
    ? "border-red-500/40 bg-red-500/10 text-red-400"
    : "border-amber-500/40 bg-amber-500/10 text-amber-400";

  return (
    <div
      className={`flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-relaxed ${cls} ${className}`}
      data-testid={`review-flag-${review.status}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-bold uppercase tracking-wide">{label}</span>
        {review.reason ? <span className="font-normal"> — {review.reason}</span> : null}
      </span>
    </div>
  );
}
