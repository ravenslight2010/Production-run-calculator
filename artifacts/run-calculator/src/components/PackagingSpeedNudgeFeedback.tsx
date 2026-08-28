import type {
  PackagingSpeedNudge,
  PackagingSpeedNudgeFeedbackStatus,
} from "../packagingSpeedNudge";

type PackagingSpeedNudgeFeedbackProps = {
  nudge: PackagingSpeedNudge | null;
  status: PackagingSpeedNudgeFeedbackStatus;
  onAccept: () => void;
  onDismiss: () => void;
};

function statusMessage(status: Exclude<PackagingSpeedNudgeFeedbackStatus, null>): string {
  if (status === "auto-disabled") {
    return "Auto is off. Turn Auto on before correcting so Packaging can compare actual output with the predicted line speed.";
  }
  if (status === "run-not-running") {
    return "Start the run before checking Packaging line speed.";
  }

  switch (status.kind) {
    case "output-time": {
      const secondsLeft = Math.max(
        0,
        Math.ceil(status.requiredOutputSec - status.elapsedOutputSec),
      );
      return `Need ${secondsLeft} more second${secondsLeft === 1 ? "" : "s"} of post-freezer output before checking line speed.`;
    }
    case "correction-size":
      return `This ${status.correctionCases}-case ${status.direction} correction needs ${status.correctionCasesNeeded} cases to suggest a speed on its own. Make one more correction in the same direction instead.`;
    case "missing-skid-size":
      return `Cases per Skid is not set, so Packaging needs two corrections in the same direction. ${status.correctionCount} of 2 recorded.`;
    case "correction-count":
      return `${status.correctionCount} same-direction correction${status.correctionCount === 1 ? "" : "s"} recorded. Make ${status.correctionsNeeded - status.correctionCount} more to check line speed.`;
    case "invalid-data":
      return "Packaging needs a valid line speed and pizzas-per-case value before it can suggest a speed.";
  }
}

/**
 * The recommendation and wait-state share one compact surface beside the
 * Packaging steppers. This prevents a manual correction from looking ignored
 * when it still needs output time or another same-direction correction.
 */
export function PackagingSpeedNudgeFeedback({
  nudge,
  status,
  onAccept,
  onDismiss,
}: PackagingSpeedNudgeFeedbackProps) {
  if (nudge) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-950/15 px-4 py-3" data-testid="speed-nudge-card">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1.5">
          Line Speed Suggestion
        </p>
        <p className="text-xs text-foreground mb-2.5">
          Line running <span className="font-semibold text-amber-300">{nudge.direction}</span> than
          predicted — adjust{" "}
          <span className="font-medium">
            {nudge.isCrust ? "Approximate Line Speed" : "Speed Adjustment"}
          </span>{" "}
          to <span className="font-mono font-bold">{nudge.value.toFixed(2)}</span>?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="speed-nudge-accept"
            onClick={onAccept}
            className="flex-1 rounded-md bg-amber-600 hover:bg-amber-500 text-black text-xs font-bold py-1.5 transition-colors"
          >
            Accept
          </button>
          <button
            type="button"
            data-testid="speed-nudge-dismiss"
            onClick={onDismiss}
            className="flex-1 rounded-md border border-border/50 bg-muted/40 hover:bg-muted text-muted-foreground text-xs py-1.5 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div
      className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-left"
      data-testid="speed-nudge-status"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1">
        Line Speed Check
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{statusMessage(status)}</p>
    </div>
  );
}