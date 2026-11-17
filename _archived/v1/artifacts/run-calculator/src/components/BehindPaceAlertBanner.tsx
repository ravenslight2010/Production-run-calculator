import { ADVISORY_AUTO_DISMISS_MS, useAutoDismissNotice } from "../hooks/useAutoDismissNotice";

export const BEHIND_PACE_AUTO_DISMISS_MS = ADVISORY_AUTO_DISMISS_MS.urgent;

export function BehindPaceAlertBanner({
  runId,
  message,
  onDismiss,
}: {
  runId: string;
  message: string;
  onDismiss: () => void;
}) {
  const autoDismiss = useAutoDismissNotice({
    identity: `${runId}:behind-pace`,
    durationMs: BEHIND_PACE_AUTO_DISMISS_MS,
    onDismiss,
  });

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-red-700/30 bg-red-950/40 px-4 py-2 text-xs font-semibold text-red-400"
      data-testid="pace-alert-banner"
      data-auto-dismiss-ms={BEHIND_PACE_AUTO_DISMISS_MS}
      {...autoDismiss}
    >
      <span>🐢 {message}</span>
      <button
        type="button"
        data-testid="button-pace-alert-dismiss"
        className="rounded-md border border-red-700/40 px-2.5 py-1 hover-elevate"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}