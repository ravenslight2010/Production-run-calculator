import { AlertTriangle, Coffee, Zap, X } from "lucide-react";
import type { ProactiveAlert } from "../aiProactive";

// Non-intrusive, dismissible banner for a single proactive shift nudge. Renders
// nothing when there's no alert. Mirrors the mobile banner (replit.md parity).
export default function ProactiveAlertBanner({
  alert,
  onDismiss,
  onApply,
}: {
  alert: ProactiveAlert | null;
  onDismiss: () => void;
  // When provided and the alert carries a suggestedAction, an "Apply" button is
  // shown next to the dismiss ×. Calling it applies the correction and clears
  // the banner (same as dismiss). Absent on alerts with no suggestedAction.
  onApply?: () => void;
}) {
  if (!alert) return null;

  const Icon =
    alert.category === "break" ? Coffee : alert.category === "efficiency" ? Zap : AlertTriangle;

  const tone =
    alert.impact === "high"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : alert.impact === "low"
        ? "border-border bg-muted/40 text-foreground"
        : "border-primary/40 bg-primary/10 text-foreground";

  const iconTone =
    alert.impact === "high"
      ? "text-amber-400"
      : alert.impact === "low"
        ? "text-muted-foreground"
        : "text-primary";

  const showApply = onApply != null && alert.suggestedAction != null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="proactive-alert"
      className={`mx-3 mt-3 flex items-start gap-3 rounded-lg border px-3 py-2.5 print:hidden ${tone}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{alert.title}</p>
        <p className="mt-0.5 text-xs leading-snug opacity-90">{alert.detail}</p>
      </div>
      {showApply && (
        <button
          type="button"
          onClick={() => { onApply(); onDismiss(); }}
          aria-label="Apply suggested correction"
          data-testid="proactive-alert-apply"
          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          Apply
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss alert"
        data-testid="proactive-alert-dismiss"
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
