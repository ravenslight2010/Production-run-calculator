import { useRef, useState, type RefObject } from "react";
import { RefreshCw } from "lucide-react";
import type { UpdateState } from "../pwaUpdateCoordinator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useAppUpdateContext } from "./appUpdateContext";
import { DropdownMenuItem } from "./ui/dropdown-menu";

const labels: Record<UpdateState["phase"], string> = {
  unchecked: "Not checked",
  checking: "Checking",
  current: "Current",
  ready: "Update ready",
  waiting: "Waiting for work to save",
  deferred: "Update paused",
  updating: "Updating",
  blocked: "Blocked by work",
  offline: "Offline",
  failed: "Update failed",
  confirmed: "Update complete",
};

const attentionPhases = new Set<UpdateState["phase"]>([
  "ready",
  "waiting",
  "deferred",
  "blocked",
  "offline",
  "failed",
]);

export function appUpdateStatusLabel(
  state: UpdateState,
  developmentPreview = false,
): string {
  return developmentPreview ? "Development preview" : labels[state.phase];
}

export function appUpdateNeedsAttention(state: UpdateState): boolean {
  return attentionPhases.has(state.phase);
}

export function useAppUpdateMenuDialog() {
  const [open, setOpen] = useState(false);
  const openAfterMenuCloseRef = useRef(false);

  const requestOpenAfterMenuClose = (closeMenu: () => void) => {
    openAfterMenuCloseRef.current = true;
    closeMenu();
  };
  const handleMenuCloseAutoFocus = (event: { preventDefault: () => void }): boolean => {
    if (!openAfterMenuCloseRef.current) return false;
    openAfterMenuCloseRef.current = false;
    event.preventDefault();
    window.requestAnimationFrame(() => setOpen(true));
    return true;
  };

  return { open, setOpen, requestOpenAfterMenuClose, handleMenuCloseAutoFocus };
}

export function AppUpdateMenuEntry({
  state,
  developmentPreview = false,
  onSelect,
}: {
  state: UpdateState;
  developmentPreview?: boolean;
  onSelect: () => void;
}) {
  const status = appUpdateStatusLabel(state, developmentPreview);
  const needsAttention = appUpdateNeedsAttention(state);
  return (
    <DropdownMenuItem
      aria-label={`App updates — ${status}${needsAttention ? ", needs attention" : ""}`}
      data-testid="menu-app-updates"
      onSelect={onSelect}
    >
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
      <span>App updates</span>
      <span className="ml-auto text-xs text-muted-foreground">{status}</span>
      {needsAttention && (
        <span className="rounded-sm border border-amber-500/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
          Needs attention
        </span>
      )}
    </DropdownMenuItem>
  );
}

function statusMessage(state: UpdateState, developmentPreview: boolean): string {
  if (developmentPreview) {
    return "Published updates are not checked in this development preview.";
  }
  switch (state.phase) {
    case "blocked":
      return "Sign in if safety cannot be checked. Finish and end the live run, save changed forms, finish the import review, and wait for pending operations before updating. A paused run still blocks updates. If this screen cannot open your work, finish it from another signed-in tab or device. Your work has not been discarded.";
    case "failed":
      return "The update could not be confirmed. Keep working or check again when online.";
    case "offline":
      return "Keep working offline. Reconnect and check again to update.";
    case "confirmed":
      return "This page is running the requested version.";
    case "checking":
      return "Checking for a newer published version.";
    case "ready":
      return "A newer version is available. Updating remains protected while work is in progress.";
    case "waiting":
      return "Update requested. It will install after the live run is ended, changed forms and open work are finished, and sync succeeds. If sync reports an error, retry or resolve it first. You can cancel the request.";
    case "deferred":
      return "The queued update was cancelled. Automatic installation is paused until you check for updates or request it again.";
    case "updating":
      return "Preparing the update. This page will move only after the existing safety checks pass.";
    case "current":
      return "This page is running the latest confirmed version.";
    case "unchecked":
    default:
      return "Check for a newer published version. Saved work is kept.";
  }
}

export function AppUpdateDetailsDialog({
  state,
  check,
  update,
  cancelUpdate,
  developmentPreview = false,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  state: UpdateState;
  check: () => void;
  update: () => void;
  cancelUpdate: () => void;
  developmentPreview?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const busy = ["checking", "waiting", "updating"].includes(state.phase);
  const hasNewVersion = Boolean(state.target && state.target !== state.running);
  const showCancel = !developmentPreview && hasNewVersion && state.phase === "waiting";
  const showUpdate = !developmentPreview && hasNewVersion && state.phase !== "waiting";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg gap-4 p-4 sm:p-6 [&>button:last-child]:min-h-[48px] [&>button:last-child]:min-w-[48px]"
        style={{
          width: "min(32rem, calc(100vw - 32px))",
          maxWidth: "calc(100vw - 32px)",
        }}
        data-testid="app-update-dialog"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef) return;
          event.preventDefault();
          window.requestAnimationFrame(() => returnFocusRef.current?.focus());
        }}
      >
        <DialogHeader className="pr-7">
          <DialogTitle>App updates</DialogTitle>
          <DialogDescription>{appUpdateStatusLabel(state, developmentPreview)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p role="status" aria-live="polite" data-testid="app-update-explanation">
            {statusMessage(state, developmentPreview)}
          </p>
          {!developmentPreview && (
            <dl className="grid grid-cols-1 gap-2 rounded-md border border-border/70 p-3 text-xs sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Running version</dt>
                <dd className="break-all font-mono" data-testid="running-build">{state.running}</dd>
              </div>
              {state.target && (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Available version</dt>
                  <dd className="break-all font-mono" data-testid="available-build">{state.target}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {!developmentPreview && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              type="button"
              className="min-h-[48px] rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={check}
              data-testid="button-check-for-updates"
            >
              Check for updates
            </button>
            {showCancel && (
              <button
                type="button"
                className="min-h-[48px] rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={cancelUpdate}
                data-testid="button-cancel-app-update"
              >
                Cancel queued update
              </button>
            )}
            {showUpdate && (
              <button
                type="button"
                className="min-h-[48px] rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={update}
                data-testid="button-update-app"
              >
                {state.phase === "deferred" ? "Resume update" : "Update app"}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AppUpdateControl({
  state,
  check,
  update,
  cancelUpdate,
  developmentPreview = false,
}: {
  state: UpdateState;
  check: () => void;
  update: () => void;
  cancelUpdate: () => void;
  developmentPreview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const status = appUpdateStatusLabel(state, developmentPreview);

  return (
    <div
      className="fixed bottom-3 right-3 z-40 max-w-[calc(100vw-1.5rem)]"
      data-testid="app-update-fallback"
    >
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex min-h-[48px] max-w-full flex-wrap items-center justify-end gap-2 rounded-md border border-border/70 px-3 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`App updates — ${status}${appUpdateNeedsAttention(state) ? ", needs attention" : ""}`}
        onClick={() => setOpen(true)}
        data-testid="button-app-update-fallback"
      >
        <span>App updates</span>
        <span aria-hidden="true">·</span>
        <span>{status}</span>
        {appUpdateNeedsAttention(state) && (
          <span className="rounded-sm border border-amber-500/60 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            Needs attention
          </span>
        )}
      </button>
      <AppUpdateDetailsDialog
        state={state}
        check={check}
        update={update}
        cancelUpdate={cancelUpdate}
        developmentPreview={developmentPreview}
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}

export function AppUpdateFallbackFromContext() {
  const { state, check, update, cancelUpdate, developmentPreview } = useAppUpdateContext();
  return (
    <AppUpdateControl
      state={state}
      check={check}
      update={update}
      cancelUpdate={cancelUpdate}
      developmentPreview={developmentPreview}
    />
  );
}
