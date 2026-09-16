import { CheckCircle2, RefreshCw } from "lucide-react";

export type ForegroundRecoveryNotice = {
  kind: "recovering" | "failed" | "outcome";
  message: string;
};

export function ForegroundRecoveryStatus({
  notice,
  acknowledgement,
  onRetry,
  onDismiss,
}: {
  notice: ForegroundRecoveryNotice;
  acknowledgement: number;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`print:hidden mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        notice.kind === "failed"
          ? "border-red-500/40 bg-red-500/10 text-red-200"
          : notice.kind === "outcome"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-100"
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="foreground-recovery-status"
      data-foreground-sync-ack={acknowledgement}
      data-foreground-recovery-state={notice.kind}
    >
      {notice.kind === "outcome"
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{notice.message}</span>
      {notice.kind === "failed" && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-current/40 px-2 py-1 text-xs font-semibold hover:bg-black/10"
          data-testid="button-retry-foreground-recovery"
        >
          Retry recovery
        </button>
      )}
      {notice.kind === "outcome" && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs font-semibold opacity-80 hover:opacity-100"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}