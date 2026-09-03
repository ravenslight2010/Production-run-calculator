import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastAction } from "@/components/ui/toast";
import { AuthProvider } from "@/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import { SignInPage, SignUpPage, ForgotPasswordPage } from "@/pages/auth";
import { startServiceWorkerUpdateChecks } from "@/pwaUpdateChecks";
import { updateAndReload } from "@/pwaUpdateRecovery";
import { useRegisterSW } from "virtual:pwa-register/react";
import { recordPerformance } from "./performanceDiagnostics";
import { emitFieldCheckSignal, FieldVerificationObserver } from "./fieldChecks";
import { WEB_BUILD_ID } from "./buildIdentity";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
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

// "/" renders the calculator for signed-in staff, and a branded welcome with a
// sign-in CTA for everyone else (no auto-redirect into the sign-in form).
function HomeGate() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return isAuthenticated ? (
    <Suspense fallback={null}>
      <LazyHome />
    </Suspense>
  ) : <Landing />;
}

function AppRoutes() {
  return (
    <TooltipProvider>
      <Switch>
        <Route path="/" component={HomeGate} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </TooltipProvider>
  );
}

type AppUpdateContextValue = {
  updateAndReload: () => Promise<void>;
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

function AppUpdatePrompt({ children }: { children: ReactNode }) {
  const stopUpdateChecksRef = useRef<(() => void) | undefined>(undefined);
  const stopUpdateWatchRef = useRef<(() => void) | undefined>(undefined);
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [activatedUpdateReady, setActivatedUpdateReady] = useState(false);
  const onRegisteredSW = useCallback(
    (
      _serviceWorkerUrl: string,
      registration: ServiceWorkerRegistration | undefined,
    ) => {
      stopUpdateChecksRef.current?.();
      stopUpdateWatchRef.current?.();
      registrationRef.current = registration;
      stopUpdateChecksRef.current = registration
        ? startServiceWorkerUpdateChecks(registration)
        : undefined;
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
            setActivatedUpdateReady(true);
            emitFieldCheckSignal("pwa-update-handoff", "success");
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
    [],
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW });
  const { toast } = useToast();
  const toastedRef = useRef(false);
  const handleUpdateAndReload = useCallback(
    () => {
      emitFieldCheckSignal("pwa-update-handoff", "success");
      return updateAndReload(
        registrationRef.current,
        updateServiceWorker,
        () => window.location.reload(),
      );
    },
    [updateServiceWorker],
  );

  useEffect(() => {
    return () => {
      stopUpdateChecksRef.current?.();
      stopUpdateChecksRef.current = undefined;
      stopUpdateWatchRef.current?.();
      stopUpdateWatchRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if ((!needRefresh && !activatedUpdateReady) || toastedRef.current) return;

    toastedRef.current = true;
    toast({
      title: "Update available",
      description: "A new version of the app is ready.",
      duration: Infinity,
      persistent: true,
      action: (
        <ToastAction
          altText="Reload now"
          onClick={() => void handleUpdateAndReload()}
        >
          Reload now
        </ToastAction>
      ),
    });
  }, [
    activatedUpdateReady,
    handleUpdateAndReload,
    needRefresh,
    toast,
  ]);

  return (
    <AppUpdateContext.Provider value={{ updateAndReload: handleUpdateAndReload }}>
      {children}
    </AppUpdateContext.Provider>
  );
}

function ErrorBoundaryWithRecovery({ children }: { children: ReactNode }) {
  const updateContext = useContext(AppUpdateContext);
  return (
    <ErrorBoundary onUpdateAndReload={updateContext?.updateAndReload}>
      {children}
    </ErrorBoundary>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AppUpdatePrompt>
          <ErrorBoundaryWithRecovery>
          <AuthProvider>
            <FieldVerificationObserver appBuild={WEB_BUILD_ID} />
            <AppRoutes />
          </AuthProvider>
          </ErrorBoundaryWithRecovery>
        </AppUpdatePrompt>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
