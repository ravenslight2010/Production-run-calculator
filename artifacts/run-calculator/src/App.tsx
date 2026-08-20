import { useCallback, useEffect, useRef } from "react";
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
import Home from "@/pages/home";
import Landing from "@/pages/landing";
import { SignInPage, SignUpPage, ForgotPasswordPage } from "@/pages/auth";
import { startServiceWorkerUpdateChecks } from "@/pwaUpdateChecks";
import { useRegisterSW } from "virtual:pwa-register/react";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// "/" renders the calculator for signed-in staff, and a branded welcome with a
// sign-in CTA for everyone else (no auto-redirect into the sign-in form).
function HomeGate() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return isAuthenticated ? <Home /> : <Landing />;
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

function AppUpdatePrompt() {
  const stopUpdateChecksRef = useRef<(() => void) | undefined>(undefined);
  const onRegisteredSW = useCallback(
    (
      _serviceWorkerUrl: string,
      registration: ServiceWorkerRegistration | undefined,
    ) => {
      stopUpdateChecksRef.current?.();
      stopUpdateChecksRef.current = registration
        ? startServiceWorkerUpdateChecks(registration)
        : undefined;
    },
    [],
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW });
  const { toast } = useToast();
  const toastedRef = useRef(false);

  useEffect(() => {
    return () => {
      stopUpdateChecksRef.current?.();
      stopUpdateChecksRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!needRefresh || toastedRef.current) return;

    toastedRef.current = true;
    toast({
      title: "Update available",
      description: "A new version of the app is ready.",
      duration: Infinity,
      persistent: true,
      action: (
        <ToastAction
          altText="Reload now"
          onClick={() => void updateServiceWorker(true)}
        >
          Reload now
        </ToastAction>
      ),
    });
  }, [needRefresh, toast, updateServiceWorker]);

  return null;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <AuthProvider>
            <AppUpdatePrompt />
            <AppRoutes />
          </AuthProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
