import { useState, type ReactNode } from "react";
import type { UpdateState } from "../pwaUpdateCoordinator";

const labels = {
  unchecked: "Not checked", checking: "Checking", current: "Current",
  ready: "Update ready", updating: "Updating", blocked: "Blocked by work",
  offline: "Offline", failed: "Update failed", confirmed: "Update complete",
};

export function AppUpdateControl({ state, check, update }: {
  state: UpdateState; check: () => void; update: () => void;
}) {
  const [open, setOpen] = useState(false);
  const busy = state.phase === "checking" || state.phase === "updating";
  let message: ReactNode = "Check for a newer published version. Saved work is kept.";
  if (state.phase === "blocked") message = "Sign in if safety cannot be checked. Finish and end the live run, save changed forms, finish the import review, and wait for pending operations before updating. A paused run still blocks updates. If this screen cannot open your work, finish it from another signed-in tab or device. Your work has not been discarded.";
  if (state.phase === "failed") message = "The update could not be confirmed. Keep working or check again when online.";
  if (state.phase === "offline") message = "Keep working offline. Reconnect and check again to update.";
  if (state.phase === "confirmed") message = "This page is running the requested version.";
  return (
    <aside className="fixed bottom-2 right-2 z-[100] max-w-[calc(100vw-1rem)] rounded-lg border bg-background p-2 text-foreground shadow-lg" aria-label="App updates">
      <button type="button" className="min-h-10 px-3 text-sm" aria-expanded={open}
        aria-controls="app-update-details" onClick={() => setOpen(!open)}>
        App updates · {labels[state.phase]}
      </button>
      {open && <div id="app-update-details" className="max-h-[60dvh] w-80 max-w-full space-y-2 overflow-y-auto p-2 text-sm">
        <p className="break-all">Running version: <code data-testid="running-build">{state.running}</code></p>
        {state.target && <p className="break-all">Available version: <code>{state.target}</code></p>}
        <p role="status" aria-live="polite">{labels[state.phase]}. {message}</p>
        {state.stage && <p className="text-xs">Update stage: {state.stage}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded border px-3" disabled={busy} onClick={check}>Check for updates</button>
          {state.target && state.target !== state.running &&
            <button type="button" className="min-h-11 rounded border px-3" disabled={busy} onClick={update}>Update app</button>}
        </div>
      </div>}
    </aside>
  );
}
