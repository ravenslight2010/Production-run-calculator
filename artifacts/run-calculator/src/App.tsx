import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerMasterDataQueryClient } from "./masterData";
import { Toaster } from "@/components/ui/toaster";
import { ToastAction } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { AuthProvider } from "@/AuthContext";
import { useAuth } from "@/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import { SignInPage, SignUpPage, InvitationPage, ForgotPasswordPage } from "@/pages/auth";
import { startServiceWorkerUpdateChecks } from "@/pwaUpdateChecks";
import { claimStaleAssetRecoveryAttempt } from "@/pwaUpdateRecovery";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Loader2 } from "lucide-react";
import { recordPerformance } from "./performanceDiagnostics";
import { MasterDataPolling } from "./masterData";
import { emitFieldCheckSignal, FieldVerificationObserver } from "./fieldChecks";
import { WEB_BUILD_ID } from "./buildIdentity";
import { installBrowserFailureCapture } from "./browserIncidentCapture";
import {
  getAutomaticUpdateReloadSafety,
  reportAutomaticUpdateReloadSafety,
  scheduleSafeIdleAutomaticRecovery,
  startUpdateReloadIdleTracking,
  subscribeAutomaticUpdateReloadSafety,
} from "./updateReloadSafety";
import { checkPreHomeReloadSafety } from "./pwaStartupSafety";
import { createUpdateCoordinator, type UpdateState } from "./pwaUpdateCoordinator";
import { AppUpdateControl } from "./components/AppUpdateControl";
import { QcImportReviewBadge } from "./components/QcImportReview";
import {
  RECIPE_QC_REVIEW_NOTICE_EVENT,
  type RecipeQcReviewAcknowledgement,
} from "./recipeQcReviewNotice";

const queryClient = new QueryClient();
registerMasterDataQueryClient(queryClient);

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
const LazyHome = lazy(() => {
  const startedAt = typeof performance === "undefined" ? null : performance.now();
  return import("@/pages/home")
    .then((module) => {
      if (startedAt !== null && typeof performance !== "undefined") {
        recordPerformance("startup:home-chunk-load", performance.now() - startedAt, "load");
      }
      return module;
    })
    .catch((error) => {
      if (startedAt !== null && typeof performance !== "undefined") {
        recordPerformance(
          "startup:home-chunk-load-failure",
          performance.now() - startedAt,
          "load",
        );
      }
      throw error;
    });
});

function AppLoadingSurface({
  error,
  onRetry,
  message,
}: {
  error?: string;
  onRetry?: () => void;
  message?: string;
}) {
  return (
    <main
      className="dark flex min-h-[100dvh] items-center justify-center bg-background px-6 py-12 text-foreground"
      data-testid="app-loading"
    >
      <div
        className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-border/50 bg-card/60 p-8 text-center shadow-md"
        role="status"
        aria-live="polite"
      >
        <img
          src={logoUrl}
          alt=""
          className="mb-5 h-16 w-16 rounded-2xl shadow-lg"
        />
        <Loader2 className="mb-4 h-7 w-7 animate-spin text-amber-400" aria-hidden="true" />
        <h1 className="text-xl font-semibold">
          {error ? "Unable to open Run Calculator" : "Opening Run Calculator"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ?? message ?? "Confirming your staff session…"}
        </p>
        {error && onRetry ? (
          <button
            type="button"
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            data-testid="auth-startup-retry"
            onClick={onRetry}
          >
            Try again
          </button>
        ) : null}
      </div>
    </main>
  );
}

// "/" renders the calculator for signed-in staff, and a branded welcome with a
// sign-in CTA for everyone else (no auto-redirect into the sign-in form).
function HomeGate() {
  const {
    me,
    isAuthenticated,
    isLoading,
    startupError,
    retryStartup,
  } = useAuth();
  const { toast } = useToast();
  const updateAndReload = useContext(AppUpdateContext)?.updateAndReload;
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    let clearWarmupFailure: (() => void) | undefined;
    // Warm the lazy workbook chunks (xlsx, specImport, …) right after sign-in
    // so an autoscale cold start can't kill the first import click with
    // "Failed to fetch dynamically imported module". If the warm-up fails,
    // surface the same update/reload recovery path used for stale workbook
    // imports: the browser may cache a failed dynamic import and refuse the
    // retry, so the user needs an explicit reload action.
    void import("./workbookWorkflow")
      .then(({ loadWorkbookWorkflow }) => loadWorkbookWorkflow())
      .catch(() => {
        if (!active) return;
        const failureToast = toast({
          variant: "destructive",
          title: "Import tools couldn't load",
          description: "The spreadsheet tools failed to download. Reload usually fixes this.",
          duration: Infinity,
          persistent: true,
          action: (
            <ToastAction
              altText="Reload now"
              onClick={() => void (updateAndReload ? updateAndReload() : window.location.reload())}
            >
              Reload now
            </ToastAction>
          ),
        });
        clearWarmupFailure = () => {
          failureToast.update({ id: failureToast.id, persistent: false });
          failureToast.dismiss();
        };
      });
    return () => {
      active = false;
      clearWarmupFailure?.();
    };
  }, [isAuthenticated, toast, updateAndReload]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onRecipeReviewAcknowledged = (event: Event) => {
      const detail = (event as CustomEvent<RecipeQcReviewAcknowledgement>).detail;
      if (!detail || detail.status !== "applied-awaiting-review") return;
      const noun = detail.changedCount === 1 ? "recipe change" : "recipe changes";
      toast({
        title: "Applied — awaiting QC review",
        description: `${detail.changedCount} shared ${noun} are saved and remain available for production. A rejection does not undo them.`,
        duration: 7000,
      });
    };
    window.addEventListener(RECIPE_QC_REVIEW_NOTICE_EVENT, onRecipeReviewAcknowledged);
    return () => window.removeEventListener(RECIPE_QC_REVIEW_NOTICE_EVENT, onRecipeReviewAcknowledged);
  }, [isAuthenticated, toast]);

  const [preHomeSafetyUserId, setPreHomeSafetyUserId] = useState<string | null>(null);
  const userId = isAuthenticated ? me?.userId ?? null : null;

  useEffect(() => {
    if (!userId) {
      reportAutomaticUpdateReloadSafety(false);
      setPreHomeSafetyUserId(null);
      return;
    }
    let current = true;
    setPreHomeSafetyUserId(null);
    reportAutomaticUpdateReloadSafety(false);
    void checkPreHomeReloadSafety().then((safe) => {
      if (!current) return;
      reportAutomaticUpdateReloadSafety(safe);
      setPreHomeSafetyUserId(userId);
    });
    return () => {
      current = false;
      reportAutomaticUpdateReloadSafety(false);
    };
  }, [userId]);

  if (isLoading) return <AppLoadingSurface />;
  if (startupError) {
    return <AppLoadingSurface error={startupError} onRetry={retryStartup} />;
  }
  if (isAuthenticated && userId && preHomeSafetyUserId !== userId) {
    return <AppLoadingSurface message="Checking current production state…" />;
  }
  return isAuthenticated ? (
    <MasterDataPolling>
      <QcImportReviewBadge key={userId ?? "anonymous"} />
      <Suspense fallback={<AppLoadingSurface />}>
        <LazyHome />
      </Suspense>
    </MasterDataPolling>
  ) : <Landing />;
}

function AppRoutes() {
  return (
    <TooltipProvider>
      <Switch>
        <Route path="/" component={HomeGate} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/accept-invitation" component={InvitationPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </TooltipProvider>
  );
}

type AppUpdateContextValue = {
  updateAndReload: (canReload?: () => boolean, verifyBeforeReload?: () => Promise<boolean>) => Promise<void>;
  scheduleSafeIdleRecovery: (
    safeAtFailure: boolean,
    recover: (canReload: () => boolean) => void | Promise<void>,
  ) => () => void;
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

function AppUpdatePrompt({ children }: { children: ReactNode }) {
  const stopUpdateWatchRef = useRef<(() => void) | undefined>(undefined);
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "unchecked", running: WEB_BUILD_ID });
  const coordinatorRef = useRef<ReturnType<typeof createUpdateCoordinator> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createUpdateCoordinator({
      registration: () => registrationRef.current,
      safe: getAutomaticUpdateReloadSafety,
      subscribeSafe: subscribeAutomaticUpdateReloadSafety,
      reload: () => window.location.reload(),
      changed: setUpdateState,
    });
  }
  const coordinator = coordinatorRef.current;
  const updateAvailable = Boolean(updateState.target && updateState.target !== WEB_BUILD_ID
    && ["ready", "blocked", "updating"].includes(updateState.phase));
  const calculatorSafe = useSyncExternalStore(
    subscribeAutomaticUpdateReloadSafety,
    getAutomaticUpdateReloadSafety,
    () => false,
  );
  const [updateIdle, setUpdateIdle] = useState(false);
  const updateIdleRef = useRef(false);
  const automaticReloadGenerationRef = useRef(0);
  const automaticReloadStartedRef = useRef(false);
  const onRegisteredSW = useCallback(
    (
      _serviceWorkerUrl: string,
      registration: ServiceWorkerRegistration | undefined,
    ) => {
      stopUpdateWatchRef.current?.();
      registrationRef.current = registration;
      if (!registration) return;

      let installingWorker: ServiceWorker | null = null;
      let onStateChange: (() => void) | undefined;
      const watchInstallingWorker = () => {
        const worker = registration.installing;
        if (!worker || worker === installingWorker) return;
        if (onStateChange && installingWorker) {
          installingWorker.removeEventListener("statechange", onStateChange);
        }
        installingWorker = worker;
        // An initial install should not prompt. For an update, the worker
        // activates without claiming this open page; staff still choose when
        // to reload into it.
        const isUpdate = Boolean(registration.active);
        onStateChange = () => {
          if (worker.state === "installed" && isUpdate) {
            void coordinator.check();
          }
        };
        worker.addEventListener("statechange", onStateChange);
        onStateChange();
      };
      registration.addEventListener("updatefound", watchInstallingWorker);
      watchInstallingWorker();
      stopUpdateWatchRef.current = () => {
        registration.removeEventListener("updatefound", watchInstallingWorker);
        if (onStateChange && installingWorker) {
          installingWorker.removeEventListener("statechange", onStateChange);
        }
      };
    },
    [coordinator],
  );
  useRegisterSW({
    onRegisteredSW,
    // Detection is not permission to reload. The coordinator owns navigation.
    onNeedReload: () => { void coordinator.check(); },
    onRegisterError: () => { void coordinator.check(); },
  });
  const handleUpdateAndReload = useCallback(
    (canReload: () => boolean = getAutomaticUpdateReloadSafety, verifyBeforeReload?: () => Promise<boolean>) =>
      coordinator.update(canReload, verifyBeforeReload),
    [coordinator],
  );
  const scheduleSafeIdleRecovery = useCallback(
    (
      safeAtFailure: boolean,
      recover: (canReload: () => boolean) => void | Promise<void>,
    ) =>
      scheduleSafeIdleAutomaticRecovery((canReload) => {
        if (automaticReloadStartedRef.current) return;
        automaticReloadStartedRef.current = true;
        void Promise.resolve(recover(canReload)).finally(() => {
          automaticReloadStartedRef.current = false;
        });
      }, safeAtFailure),
    [],
  );
  const handleAutomaticUpdateAndReload = useCallback(
    (generation: number) => {
      const canReload = () =>
        automaticReloadGenerationRef.current === generation
        && getAutomaticUpdateReloadSafety()
        && updateIdleRef.current;
      if (!canReload()) return Promise.resolve();
      // Fail closed if this tab cannot retain its once-only automatic claim.
      try {
        if (!claimStaleAssetRecoveryAttempt(`update:${WEB_BUILD_ID}:${coordinator.snapshot().target}`, sessionStorage)) return Promise.resolve();
        if (!sessionStorage.getItem(`run-calc:stale-asset-recovery:update:${WEB_BUILD_ID}:${coordinator.snapshot().target}`)) return Promise.resolve();
      } catch { return Promise.resolve(); }
      return coordinator.update(canReload);
    },
    [coordinator],
  );

  useEffect(() => {
    const initial = coordinator.start();
    setUpdateState(initial);
    if (initial.phase === "confirmed") emitFieldCheckSignal("pwa-update-handoff", "success");
    const check = () => { void coordinator.check(); };
    const stop = startServiceWorkerUpdateChecks({
      update: async () => registrationRef.current?.update(),
    }, undefined, check);
    window.addEventListener("online", check);
    return () => { stop(); window.removeEventListener("online", check); };
  }, [coordinator]);

  useEffect(() => {
    return () => {
      stopUpdateWatchRef.current?.();
      stopUpdateWatchRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const updateReady = updateAvailable;
    updateIdleRef.current = false;
    setUpdateIdle(false);
    automaticReloadGenerationRef.current += 1;
    if (!updateReady || !calculatorSafe) return;

    return startUpdateReloadIdleTracking((idle) => {
      updateIdleRef.current = idle;
      if (!idle) automaticReloadGenerationRef.current += 1;
      setUpdateIdle(idle);
    });
  }, [calculatorSafe, updateAvailable]);

  useEffect(() => {
    const updateReady = updateState.phase === "ready" || updateState.phase === "blocked";
    if (!updateReady || !updateIdle || !calculatorSafe) return;
    if (automaticReloadStartedRef.current) return;

    const generation = automaticReloadGenerationRef.current;
    automaticReloadStartedRef.current = true;
    void handleAutomaticUpdateAndReload(generation).finally(() => {
      automaticReloadStartedRef.current = false;
    });
  }, [
    updateState.phase,
    calculatorSafe,
    handleAutomaticUpdateAndReload,
    updateIdle,
  ]);

  return (
    <AppUpdateContext.Provider value={{
      updateAndReload: handleUpdateAndReload,
      scheduleSafeIdleRecovery,
    }}>
      <AppUpdateControl state={updateState}
        check={() => void coordinator.check()}
        update={() => void coordinator.requestUpdate()}
        cancelUpdate={() => coordinator.cancelQueuedUpdate()} />
      {children}
    </AppUpdateContext.Provider>
  );
}

function ErrorBoundaryWithRecovery({ children }: { children: ReactNode }) {
  const updateContext = useContext(AppUpdateContext);
  return (
    <ErrorBoundary
      onUpdateAndReload={updateContext?.updateAndReload}
      scheduleSafeIdleRecovery={updateContext?.scheduleSafeIdleRecovery}
    >
      {children}
    </ErrorBoundary>
  );
}

import { ImportSafetyReviewHost } from "./components/ImportSafetyReviewHost";

function App() {
  const isStationDisplay =
    new URLSearchParams(window.location.search).get("screen") !== null;
  useEffect(() => {
    if (isStationDisplay) return;
    return installBrowserFailureCapture();
  }, [isStationDisplay]);
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AppUpdatePrompt>
          <ErrorBoundaryWithRecovery>
          <AuthProvider>
            <ImportSafetyReviewHost />
            {!isStationDisplay && <FieldVerificationObserver appBuild={WEB_BUILD_ID} />}
            <AppRoutes />
          </AuthProvider>
          </ErrorBoundaryWithRecovery>
        </AppUpdatePrompt>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
