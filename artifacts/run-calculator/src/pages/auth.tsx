import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/useAuth";
import {
  checkUsernameAvailable,
  forgotPasswordRequest,
  resetPasswordRequest,
  InventoryApiError,
} from "@/inventoryShared";

const MIN_PASSWORD_LENGTH = 6;
const MIN_USERNAME_LENGTH = 3;
const USERNAME_CHECK_DEBOUNCE_MS = 400;

type UsernameStatus = "idle" | "short" | "checking" | "available" | "taken";

// Debounced, read-only availability lookup for the sign-up username field. The
// status mirrors the live password hints: neutral while empty/too short or in
// flight, green once we know it's free, red once we know it's taken. Network
// errors fall back to neutral so a flaky check never blocks the form.
function useUsernameAvailability(
  username: string,
  enabled: boolean,
): UsernameStatus {
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const handle = username.trim();

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    if (handle.length === 0) {
      setStatus("idle");
      return;
    }
    if (handle.length < MIN_USERNAME_LENGTH) {
      setStatus("short");
      return;
    }
    setStatus("checking");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { available } = await checkUsernameAvailable(handle);
        if (!cancelled) setStatus(available ? "available" : "taken");
      } catch {
        if (!cancelled) setStatus("idle");
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, enabled]);

  return status;
}

function UsernameHint({ status }: { status: UsernameStatus }) {
  if (status === "available") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
        <Check className="h-3.5 w-3.5 opacity-100" />
        Username is available
      </p>
    );
  }
  if (status === "taken") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <X className="h-3.5 w-3.5 opacity-100" />
        That username is already taken
      </p>
    );
  }
  if (status === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin opacity-100" />
        Checking availability…
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="h-3.5 w-3.5 opacity-40" />
      At least {MIN_USERNAME_LENGTH} characters
    </p>
  );
}

type Mode = "sign-in" | "sign-up";

function messageForError(err: unknown, mode: Mode): string {
  if (err instanceof InventoryApiError) {
    if (mode === "sign-in" && err.status === 401)
      return "Incorrect username or password.";
    if (mode === "sign-up" && err.status === 403)
      return "Incorrect facility code. Ask your manager for the correct sign-up code.";
    if (mode === "sign-up" && err.status === 409)
      return "That username is already taken.";
    if (err.status === 400)
      return "Username must be 3–64 characters and password at least 6.";
    if (err.serverMessage) return err.serverMessage;
  }
  return "Something went wrong. Please try again.";
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  const { className, ...rest } = props;
  return (
    <div className="relative">
      <Input
        {...rest}
        type={show ? "text" : "password"}
        className={`text-foreground pr-10 ${className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
      >
        {show ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function PasswordHint({ value }: { value: string }) {
  const ok = value.length >= MIN_PASSWORD_LENGTH;
  return (
    <p
      className={`flex items-center gap-1.5 text-xs ${
        ok ? "text-green-600 dark:text-green-500" : "text-muted-foreground"
      }`}
    >
      <Check className={`h-3.5 w-3.5 ${ok ? "opacity-100" : "opacity-40"}`} />
      At least {MIN_PASSWORD_LENGTH} characters
    </p>
  );
}

function ConfirmPasswordHint({
  password,
  confirm,
}: {
  password: string;
  confirm: string;
}) {
  if (confirm.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 opacity-40" />
        Re-enter your password to confirm
      </p>
    );
  }
  const matches = password === confirm;
  return (
    <p
      className={`flex items-center gap-1.5 text-xs ${
        matches
          ? "text-green-600 dark:text-green-500"
          : "text-destructive"
      }`}
    >
      {matches ? (
        <Check className="h-3.5 w-3.5 opacity-100" />
      ) : (
        <X className="h-3.5 w-3.5 opacity-100" />
      )}
      {matches ? "Passwords match" : "Passwords don't match"}
    </p>
  );
}

function AuthForm({ mode }: { mode: Mode }) {
  const [, setLocation] = useLocation();
  const { signIn, signUp, signInAsTest } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
  const isSignUp = mode === "sign-up";
  const usernameStatus = useUsernameAvailability(username, isSignUp);

  async function handleTestLogin() {
    setError(null);
    setSubmitting(true);
    try {
      await signInAsTest();
      setLocation("/");
    } catch {
      setError("Could not sign in to the sandbox. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSignUp && usernameStatus === "taken") {
      setError("That username is already taken.");
      return;
    }
    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (isSignUp && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUp(username.trim(), password, accessCode.trim());
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
    <div className="dark flex min-h-[100dvh] items-center justify-center bg-background text-foreground px-6 py-12">
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
          className="overflow-hidden rounded-2xl border border-border/50 bg-card/50 shadow-md"
        >
          <div className="h-1 w-full bg-amber-500/70" />
          <div className="p-6">
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
              {isSignUp && <UsernameHint status={usernameStatus} />}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-foreground">
                Password
              </Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {isSignUp && <PasswordHint value={password} />}
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

            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-foreground">
                  Confirm password
                </Label>
                <PasswordInput
                  id="confirm"
                  name="confirm-password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <ConfirmPasswordHint password={password} confirm={confirm} />
              </div>
            )}

            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="accessCode" className="text-foreground">
                  Facility access code
                </Label>
                <Input
                  id="accessCode"
                  name="accessCode"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  className="text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Ask your manager for the code new staff use to sign up.
                </p>
              </div>
            )}

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

            {!isSignUp && (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => void handleTestLogin()}
                className="w-full font-semibold"
              >
                Log in as test user (sandbox)
              </Button>
            )}
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
          </div>
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
    <div className="dark flex min-h-[100dvh] items-center justify-center bg-background text-foreground px-6 py-12">
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

        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/50 shadow-md">
          <div className="h-1 w-full bg-amber-500/70" />
          <div className="p-6">
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
                <PasswordInput
                  id="rp"
                  name="new-password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <PasswordHint value={password} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp2" className="text-foreground">
                  Confirm new password
                </Label>
                <PasswordInput
                  id="rp2"
                  name="confirm-password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <ConfirmPasswordHint password={password} confirm={confirm} />
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
    </div>
  );
}

export function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
