import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportBrowserFailure } from "../browserIncidentCapture";
import { WEB_BUILD_ID } from "../buildIdentity";
import {
  claimStaleAssetRecoveryAttempt,
  recordStaleAssetRecoveryAttempt,
} from "../pwaUpdateRecovery";
import { emitFieldCheckSignal } from "../fieldChecks";
import { checkPreHomeReloadSafety } from "../pwaStartupSafety";
import {
  getAutomaticUpdateReloadSafety,
  reportAutomaticUpdateReloadSafety,
} from "../updateReloadSafety";

type Props = {
  children: ReactNode;
  onUpdateAndReload?: (canReload?: () => boolean, verifyBeforeReload?: () => Promise<boolean>) => Promise<void> | void;
  scheduleSafeIdleRecovery?: (
    safeAtFailure: boolean,
    recover: (canReload: () => boolean) => void | Promise<void>,
  ) => () => void;
};
type State = {
  error: Error | null;
  diagnosticReference: string | null;
  safeAtFailure: boolean;
};

export function isMissingNotificationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.trim().replace(/\s+/g, " ") === "Can't find variable: Notification"
  );
}

export function isStaleDeploymentAssetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.name}: ${error.message}`.trim().replace(/\s+/g, " ");
  return (
    /failed to fetch dynamically imported module/i.test(message)
    || /error loading dynamically imported module/i.test(message)
    || /importing a module script failed/i.test(message)
    || (
      /module script/i.test(message)
      && /(?:mime type|disallowed mime)/i.test(message)
      && /text\/html/i.test(message)
    )
    || (
      /(?:chunkloaderror|loading chunk [\w-]+ failed)/i.test(message)
      && /(?:\.js|chunk)/i.test(message)
    )
    || (
      /(?:404|not found|err_aborted)/i.test(message)
      && /\/assets\/[^?\s]+-[a-z0-9_-]{6,}\.js(?:[?\s]|$)/i.test(message)
    )
  );
}

const bound = (value: string | undefined, limit: number) =>
  value ? value.slice(0, limit) : value;

// Top-level safety net: if any screen throws while rendering, we catch it,
// auto-submit a crash incident (so a manager sees it even if the user never
// files a report), and show a recovery screen. The AI can't edit code, so
// "recovery" here is a safe retry/reload — never an automated code change.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, diagnosticReference: null, safeAtFailure: false };
  private cancelSafeIdleRecovery?: () => void;
  private staleAssetRecoveryStarted = false;

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      diagnosticReference: null,
      // Capture before the failed child unmounts and reports itself unsafe.
      safeAtFailure: getAutomaticUpdateReloadSafety(),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const failureKind = isStaleDeploymentAssetError(error)
      ? "stale_deployment_asset"
      : isMissingNotificationError(error)
        ? "outdated_browser_api"
        : "application_exception";
    // Fire-and-forget: a failed report must not mask the original crash.
    void reportBrowserFailure(needsUpdateFailureKind(failureKind) ? "update" : "crash", error, {
      errorMessage: bound(`[${failureKind}] ${error.message}`, 500) ?? `[${failureKind}]`,
      errorStack: bound(
        [error.stack, info.componentStack].filter(Boolean).join("\n\n"),
        4_000,
      ),
    }).then((result) => {
      if (result?.correlationId) this.setState({ diagnosticReference: result.correlationId });
    });
    if (failureKind === "stale_deployment_asset" && this.props.scheduleSafeIdleRecovery) {
      this.cancelSafeIdleRecovery = this.props.scheduleSafeIdleRecovery(
        this.state.safeAtFailure,
        (canReload) => this.recoverStaleAssetWhenSafe(canReload),
      );
    }
  }

  componentWillUnmount() {
    this.cancelSafeIdleRecovery?.();
  }

  private async recoverStaleAssetWhenSafe(canReload: () => boolean): Promise<void> {
    if (
      this.staleAssetRecoveryStarted ||
      !this.props.onUpdateAndReload ||
      !canReload() ||
      !claimStaleAssetRecoveryAttempt(WEB_BUILD_ID)
    ) return;

    const safeNow = await checkPreHomeReloadSafety();
    if (!canReload()) return;
    if (!safeNow) {
      reportAutomaticUpdateReloadSafety(false);
      this.setState({ safeAtFailure: false });
      return;
    }
    reportAutomaticUpdateReloadSafety(true);

    this.staleAssetRecoveryStarted = true;
    this.recordRecoveryAttempt();
    try {
      if (canReload()) await this.props.onUpdateAndReload(canReload, checkPreHomeReloadSafety);
    } catch {
      // The persistent update control owns retry and diagnostics. Never erase
      // an offline shell or bypass its guard with an emergency reload.
      emitFieldCheckSignal("stale-deployment-recovery", "incomplete");
    }
  }

  private recordRecoveryAttempt(): void {
    recordStaleAssetRecoveryAttempt(WEB_BUILD_ID);
    emitFieldCheckSignal("stale-deployment-recovery", "incomplete");
  }

  render() {
    if (!this.state.error) return this.props.children;
    const staleDeploymentAsset = isStaleDeploymentAssetError(this.state.error);
    const needsUpdate = isMissingNotificationError(this.state.error) || staleDeploymentAsset;
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-red-500/15">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            {needsUpdate
              ? "This older app version needs an update before it can continue. We've sent the details to your manager."
              : "The app hit an unexpected error and couldn't continue. We've sent the details to your manager. Reloading usually clears it — your saved work isn't affected."}
          </p>
          {staleDeploymentAsset && (
            <p className="text-xs text-muted-foreground">
              {this.state.safeAtFailure
                ? "Because reload was safe when the error occurred, the app will try one update after a minute without activity."
                : "Automatic recovery is paused because the app could not confirm that reloading was safe. Finish active work before updating."}
            </p>
          )}
          {this.state.diagnosticReference && (
            <p className="text-xs text-muted-foreground">
              Diagnostic reference:{" "}
              <code className="select-all font-mono text-foreground">
                {this.state.diagnosticReference}
              </code>
            </p>
          )}
          <Button
            onClick={() => {
              this.cancelSafeIdleRecovery?.();
              this.cancelSafeIdleRecovery = undefined;
              if (needsUpdate && this.props.onUpdateAndReload) {
                void this.manualUpdate(staleDeploymentAsset);
              } else {
                window.location.reload();
              }
            }}
            className="mx-auto"
          >
            <RefreshCw className="w-4 h-4 mr-2" />{" "}
            {needsUpdate ? "Update and reload" : "Reload the app"}
          </Button>
        </div>
      </main>
    );
  }

  private async manualUpdate(staleDeploymentAsset: boolean): Promise<void> {
    // A manual click is permission to try, not permission to discard work.
    const safeAtFailure = this.state.safeAtFailure;
    const safeNow = safeAtFailure && await checkPreHomeReloadSafety();
    if (staleDeploymentAsset && safeNow) this.recordRecoveryAttempt();
    await this.props.onUpdateAndReload?.(() => safeAtFailure && safeNow, checkPreHomeReloadSafety);
  }
}

function needsUpdateFailureKind(failureKind: string): boolean {
  return failureKind === "stale_deployment_asset" || failureKind === "outdated_browser_api";
}
