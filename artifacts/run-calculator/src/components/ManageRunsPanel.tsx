import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { useHomeCtx } from "../contexts/HomeCtx";
import { runLabel } from "../utils";
import { isBlankRemovableRun } from "../storage";

/**
 * ManageRunsPanel — supervisor-only panel in the Settings dialog.
 *
 * Lists all of today's runs with their status and lets managers:
 *   • Delete individual not-started runs (with inline confirmation)
 *   • Sweep all blank placeholder runs in one action
 *
 * Active (in-progress) and completed runs are shown read-only — they
 * cannot be deleted from here.  The live Run tab remains free of any
 * delete affordances.
 */
export default function ManageRunsPanel() {
  const {
    dayState,
    removeRunById,
    removeBlankRuns,
    blankRunIds,
    currentRunId,
  } = useHomeCtx();

  // ID of the run currently awaiting inline delete confirmation.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const runs: { id: string; startedAt?: number | null; endedAt?: number | null; brand?: string; flavor?: string }[] =
    dayState.runs ?? [];

  function statusLabel(r: typeof runs[number]) {
    if (r.endedAt) return { text: "Completed", cls: "bg-emerald-500/20 text-emerald-400" };
    if (r.startedAt) return { text: "In progress", cls: "bg-amber-500/20 text-amber-400" };
    return { text: "Not started", cls: "bg-muted text-muted-foreground" };
  }

  function canDelete(r: typeof runs[number]) {
    return !r.startedAt && !r.endedAt && runs.length > 1;
  }

  const blankCount = blankRunIds.length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Remove runs added by mistake. Active and completed runs cannot be
        deleted. Changes sync to all devices.
      </p>

      {/* Run list */}
      <div className="space-y-2">
        {runs.map((r, i) => {
          const label = runLabel(r as Parameters<typeof runLabel>[0]) || `Run ${i + 1}`;
          const status = statusLabel(r);
          const deletable = canDelete(r);
          const isCurrentRun = r.id === currentRunId;
          const isConfirming = confirmId === r.id;

          return (
            <div
              key={r.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-background/40"
            >
              {/* Run number */}
              <span className="text-xs text-muted-foreground font-mono shrink-0 w-7 text-right">
                {i + 1}
              </span>

              {/* Label + current badge */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium truncate">{label}</span>
                  {isCurrentRun && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                      current
                    </span>
                  )}
                </div>
              </div>

              {/* Status badge */}
              <span
                className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${status.cls}`}
              >
                {status.text}
              </span>

              {/* Delete / confirm controls */}
              {deletable && (
                isConfirming ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-destructive font-medium">Remove?</span>
                    <button
                      type="button"
                      onClick={() => {
                        removeRunById(r.id);
                        setConfirmId(null);
                      }}
                      className="px-2.5 py-1 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="px-2.5 py-1 rounded border border-border text-xs font-medium hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(r.id)}
                    title="Remove this run"
                    className="shrink-0 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Blank-run sweep */}
      {blankCount > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              <span className="font-semibold">{blankCount} blank run{blankCount > 1 ? "s" : ""}</span>{" "}
              {blankCount > 1 ? "have" : "has"} no brand, flavor, or data.
            </p>
          </div>
          <button
            type="button"
            onClick={removeBlankRuns}
            className="w-full px-3 py-2 rounded-md bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors"
          >
            Remove all {blankCount} blank run{blankCount > 1 ? "s" : ""}
          </button>
        </div>
      )}

      {runs.length <= 1 && blankCount === 0 && (
        <p className="text-xs text-muted-foreground italic text-center py-2">
          Only one run today — nothing to remove.
        </p>
      )}
    </div>
  );
}
