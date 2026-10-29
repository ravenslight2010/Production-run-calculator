import { useState, type ReactNode } from "react";
import type { UpdateState } from "../pwaUpdateCoordinator";

const labels = {
  unchecked: "Not checked", checking: "Checking", current: "Current",
  ready: "Update ready", waiting: "Waiting for work to save", deferred: "Update paused", updating: "Updating", blocked: "Blocked by work",
  offline: "Offline", failed: "Update failed", confirmed: "Update complete",
};

export function AppUpdateControl({
  state,
  check,
  update,
  cancelUpdate,
  autoReloadSafe,
  autoReloadIdle,
}: {
  state: UpdateState; check: () => void; update: () => void; cancelUpdate: () => void;
  autoReloadSafe?: boolean;
  autoReloadIdle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const busy = state.phase === "checking" || state.phase === "waiting" || state.phase === "updating";
  let message: ReactNode = "Check for a newer published version. Saved work is kept.";
  if (state.phase === "blocked") message = "Sign in if safety cannot be checked. Finish and end the live run, save changed forms, finish the import review, and wait for pending operations before updating. A paused run still blocks updates. If this screen cannot open your work, finish it from another signed-in tab or device. Your work has not been discarded.";
  if (state.phase === "failed") message = "The update could not be confirmed. Keep working or check again when online.";
  if (state.phase === "offline") message = "Keep working offline. Reconnect and check again to update.";
  if (state.phase === "confirmed") message = "This page is running the requested version.";
  if (state.phase === "checking") message = "Checking for a newer published version.";
  if (state.phase === "ready") message = "A newer version is available. Updating remains protected while work is in progress.";
  if (state.phase === "waiting") message = "Update requested. It will install after the live run is ended, changed forms and open work are finished, and sync succeeds. If sync reports an error, retry or resolve it first. You can cancel the request.";
  if (state.phase === "deferred") message = "The queued update was cancelled. Automatic installation is paused until you check for updates or request it again.";
  if (state.phase === "updating") message = "Preparing the update. This page will move only after the existing safety checks pass.";
  const showAttention = !["unchecked", "current"].includes(state.phase);
  return (
    <aside
      className="relative z-10 max-h-[calc(100dvh-5rem)] w-full overflow-y-auto overscroll-contain border-b border-border/80 bg-background text-foreground"
      aria-label="App updates"
      data-testid="app-update-control"
      data-update-reload-safe={autoReloadSafe === undefined ? undefined : String(autoReloadSafe)}
      data-update-reload-idle={autoReloadIdle === undefined ? undefined : String(autoReloadIdle)}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 sm:px-4">
        <button
          type="button"
          className="min-h-10 rounded px-2 text-left text-sm font-semibold hover:bg-muted/60"
          aria-expanded={open}
          aria-controls="app-update-details"
          onClick={() => setOpen(!open)}
          data-testid="button-app-update-details"
        >
          App updates · {labels[state.phase]}
        </button>
        <button
          type="button"
          className="min-h-10 rounded border border-border px-3 text-sm font-medium hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={check}
          data-testid="button-check-for-updates"
        >
          Check for updates
        </button>
        {state.target && state.target !== state.running && state.phase === "waiting" ? (
          <button
            type="button"
            className="min-h-10 rounded border border-border px-3 text-sm font-medium hover:bg-muted/60"
            onClick={cancelUpdate}
            data-testid="button-cancel-app-update"
          >
            Cancel queued update
          </button>
        ) : state.target && state.target !== state.running && (
          <button
            type="button"
            className="min-h-10 rounded border border-border px-3 text-sm font-medium hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={update}
            data-testid="button-update-app"
          >
            {state.phase === "deferred" ? "Resume update" : "Update app"}
          </button>
        )}
        {showAttention && (
          <p className="w-full break-words px-2 pb-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            {labels[state.phase]}. {message}
          </p>
        )}
        {open && (
          <div
            id="app-update-details"
            className="w-full space-y-1 border-t border-border/70 px-2 py-2 text-xs"
            data-testid="app-update-details"
          >
            <p className="break-all">Running version: <code data-testid="running-build">{state.running}</code></p>
            {state.target && <p className="break-all">Available version: <code>{state.target}</code></p>}
            {!showAttention && <p>{labels[state.phase]}. {message}</p>}
            {state.stage && <p>Update stage: {state.stage}</p>}
          </div>
        )}
      </div>
    </aside>
  );
}
