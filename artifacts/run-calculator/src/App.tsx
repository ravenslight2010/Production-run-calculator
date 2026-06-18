import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/AuthContext";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Landing from "@/pages/landing";
import { SignInPage, SignUpPage, ForgotPasswordPage } from "@/pages/auth";

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

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
