import { createContext, useContext, type Context } from "react";
import type { StaffMember } from "./inventoryShared";

// The auth context object + `useAuth` live in this component-free module so the
// file exporting `AuthProvider` (AuthContext.tsx) contains ONLY a component and
// satisfies React Fast Refresh's boundary rule. Two auto-captured incidents
// showed a Vite HMR partial reload creating TWO live copies of the old mixed
// module — the mounted Provider used one context object while `useAuth` read
// from the other, so consumers saw null and crashed with "useAuth must be used
// within an AuthProvider" even though the Provider was an ancestor.

export type AuthContextValue = {
  me: StaffMember | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (
    username: string,
    password: string,
    accessCode: string,
  ) => Promise<void>;
  // Shortcut that signs in as the seeded sandbox account ("test"/"test"), which
  // operates in the isolated sandbox data scope.
  signInAsTest: () => Promise<void>;
  signOut: () => Promise<void>;
  // Drop straight to the signed-out UI without calling the sign-out endpoint.
  // Used by the daily-reset rollover so the credential survives long enough for
  // the rollover's own sync push to land (the server boundary then invalidates
  // it), and by the 401 handler when the session is already gone server-side.
  forceSignedOut: () => void;
  // Re-check the session against the server (used when the SSE stream errors,
  // which can mean the daily reset just signed us out).
  revalidate: () => void;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  // Mark the first-login "Get Started" overview as seen, persisting it
  // server-side and updating the cached identity so it won't auto-open again.
  markOnboardingSeen: () => Promise<void>;
  // Mark the guided tour as completed (user reached its final step), persisting
  // it server-side and updating the cached identity.
  markTourCompleted: () => Promise<void>;
};

// Belt-and-braces: in dev, stash the created context on a globalThis singleton
// so even if HMR ever re-instantiates THIS module twice, both copies still
// share the one context object. Production builds keep a plain module constant.
const AUTH_CONTEXT_GLOBAL_KEY = "__runCalcAuthContext__";

function obtainAuthContext(): Context<AuthContextValue | null> {
  if (import.meta.env.DEV) {
    const globalStore = globalThis as typeof globalThis &
      Record<string, unknown>;
    const existing = globalStore[AUTH_CONTEXT_GLOBAL_KEY];
    if (existing) return existing as Context<AuthContextValue | null>;
    const created = createContext<AuthContextValue | null>(null);
    globalStore[AUTH_CONTEXT_GLOBAL_KEY] = created;
    return created;
  }
  return createContext<AuthContextValue | null>(null);
}

export const AuthContext = obtainAuthContext();

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
