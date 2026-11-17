import { ArrowRight, CheckCircle2, Timer } from "lucide-react";
import { useLiveRun } from "../contexts/LiveRunContext";

export function BatchDueNoticeDock({
  onNavigateToDough,
  enabled = true,
}: {
  onNavigateToDough: () => void;
  enabled?: boolean;
}) {
  const { showBatchDue, setShowBatchDue } = useLiveRun();

  if (!enabled || !showBatchDue) return null;

  return (
    <aside
      className="batch-due-notice-dock print:hidden sm:hidden"
      role="status"
      aria-live="polite"
      data-testid="batch-due-notice-dock"
    >
      <div className="batch-due-notice-panel mx-auto flex w-full max-w-[64rem] flex-wrap items-center gap-2 rounded-xl border border-orange-500/50 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Timer className="h-5 w-5 shrink-0 text-orange-400" aria-hidden="true" />
          <p className="min-w-0 text-sm font-semibold leading-snug">
            Dough batch due. Start the next batch when ready.
          </p>
        </div>
        <div className="ml-auto flex w-full shrink-0 gap-2 sm:w-auto">
          <button
            type="button"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
            onClick={onNavigateToDough}
            data-testid="button-open-dough-from-batch-reminder"
          >
            Open Dough <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md bg-amber-500 px-3 text-sm font-bold text-black hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
            onClick={() => setShowBatchDue(false)}
            data-testid="button-dismiss-batch-reminder-dock"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Dismiss reminder
          </button>
        </div>
      </div>
    </aside>
  );
}
