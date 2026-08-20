import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportIncident } from "../inventoryShared";
import { WEB_BUILD_ID } from "../buildIdentity";

type Props = {
  children: ReactNode;
  onUpdateAndReload?: () => Promise<void> | void;
};
type State = { error: Error | null };

export function isMissingNotificationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.trim().replace(/\s+/g, " ") === "Can't find variable: Notification"
  );
}

// Top-level safety net: if any screen throws while rendering, we catch it,
// auto-submit a crash incident (so a manager sees it even if the user never
// files a report), and show a recovery screen. The AI can't edit code, so
// "recovery" here is a safe retry/reload — never an automated code change.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Fire-and-forget: a failed report must not mask the original crash.
    void reportIncident({
      source: "auto_crash",
      screen: typeof window !== "undefined" ? window.location.pathname : "unknown",
      appPlatform: "web",
      appVersion: WEB_BUILD_ID,
      errorMessage: error.message,
      errorStack: [error.stack, info.componentStack].filter(Boolean).join("\n\n"),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    const needsUpdate = isMissingNotificationError(this.state.error);
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
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
          <Button
            onClick={() => {
              if (needsUpdate && this.props.onUpdateAndReload) {
                void this.props.onUpdateAndReload();
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
      </div>
    );
  }
}
