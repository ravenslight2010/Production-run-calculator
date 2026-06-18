import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/AuthContext";
import { InventoryApiError } from "@/inventoryShared";

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
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-slate-700">
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
                className="border-slate-300 text-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-700">
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
                className="border-slate-300 text-slate-900"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-amber-500 font-semibold text-white hover:bg-amber-600"
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

          <p className="mt-5 text-center text-sm text-slate-500">
            {isSignUp ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="font-medium text-amber-600 hover:text-amber-700"
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
                  className="font-medium text-amber-600 hover:text-amber-700"
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
