import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/AuthContext";
import {
  forgotPasswordRequest,
  resetPasswordRequest,
  InventoryApiError,
} from "@/inventoryShared";

const MIN_PASSWORD_LENGTH = 6;

type Mode = "sign-in" | "sign-up";

function messageForError(err: unknown, mode: Mode): string {
  if (err instanceof InventoryApiError) {
    if (mode === "sign-in" && err.status === 401)
      return "Incorrect username or password.";
    if (mode === "sign-up" && err.status === 409)
      return "That username is already taken.";
    if (err.status === 400)
      return "Username must be 3–64 characters and password at least 6.";
    if (err.serverMessage) return err.serverMessage;
  }
  return "Something went wrong. Please try again.";
}

function AuthForm({ mode }: { mode: Mode }) {
  const [, setLocation] = useLocation();
  const { signIn, signUp } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
  const isSignUp = mode === "sign-up";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUp(username.trim(), password);
      } else {
        await signIn(username.trim(), password);
      }
      // On success the ["me"] query flips to authenticated and "/" renders the
      // app; route there explicitly so the auth screen is left behind.
      setLocation("/");
    } catch (err) {
      setError(messageForError(err, mode));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img
            src={logoUrl}
            alt="Run Calculator"
            className="mx-auto mb-4 h-16 w-16 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {isSignUp ? "Create your staff account" : "Sign in to Run Calculator"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isSignUp ? "Get access to Run Calculator" : "Staff access only"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-card-border bg-card p-6 shadow-xl"
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-foreground">
                Username
              </Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-foreground">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="text-foreground"
              />
              {!isSignUp && (
                <div className="text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:text-primary/90"
                    onClick={() => setLocation("/forgot-password")}
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full font-semibold"
            >
              {submitting
                ? isSignUp
                  ? "Creating account…"
                  : "Signing in…"
                : isSignUp
                  ? "Create account"
                  : "Sign in"}
            </Button>
          </div>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {isSignUp ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:text-primary/90"
                  onClick={() => setLocation("/sign-in")}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Need an account?{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:text-primary/90"
                  onClick={() => setLocation("/sign-up")}
                >
                  Create one
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}

export function SignInPage() {
  return <AuthForm mode="sign-in" />;
}

export function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}

type ResetStep = "request" | "verify" | "done";

function ForgotPasswordForm() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<ResetStep>("request");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPasswordRequest(username.trim());
      // Always succeeds (enumeration-safe); advance to code entry regardless.
      setStep("verify");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPasswordRequest(username.trim(), code.trim(), password);
      setStep("done");
    } catch (err) {
      if (err instanceof InventoryApiError && err.status === 401) {
        setError("That reset code is invalid or has expired.");
      } else if (err instanceof InventoryApiError && err.serverMessage) {
        setError(err.serverMessage);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img
            src={logoUrl}
            alt="Run Calculator"
            className="mx-auto mb-4 h-16 w-16 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "request"
              ? "Enter your username to request a reset"
              : step === "verify"
                ? "Enter the code your manager gives you"
                : "Your password has been reset"}
          </p>
        </div>

        <div className="rounded-2xl border border-card-border bg-card p-6 shadow-xl">
          {step === "request" && (
            <form onSubmit={handleRequest} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ru" className="text-foreground">
                  Username
                </Label>
                <Input
                  id="ru"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="text-foreground"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={submitting}
                className="w-full font-semibold"
              >
                {submitting ? "Requesting…" : "Request reset"}
              </Button>
            </form>
          )}

          {step === "verify" && (
            <form onSubmit={handleReset} className="space-y-4">
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Ask your manager to approve your request. They'll give you a
                one-time code to enter below.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="rc" className="text-foreground">
                  Reset code
                </Label>
                <Input
                  id="rc"
                  name="code"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="XXXX-XXXX"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp" className="text-foreground">
                  New password
                </Label>
                <Input
                  id="rp"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp2" className="text-foreground">
                  Confirm new password
                </Label>
                <Input
                  id="rp2"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="text-foreground"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={submitting}
                className="w-full font-semibold"
              >
                {submitting ? "Resetting…" : "Reset password"}
              </Button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4">
              <p className="text-sm text-foreground">
                Your password has been reset. You can now sign in with your new
                password.
              </p>
              <Button
                type="button"
                onClick={() => setLocation("/sign-in")}
                className="w-full font-semibold"
              >
                Go to sign in
              </Button>
            </div>
          )}

          {step !== "done" && (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              <button
                type="button"
                className="font-medium text-primary hover:text-primary/90"
                onClick={() => setLocation("/sign-in")}
              >
                Back to sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
