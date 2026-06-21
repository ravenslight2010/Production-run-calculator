import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePasswordRequest,
  fetchMe,
  markOnboardingSeenRequest,
  markTourCompletedRequest,
  setUnauthorizedHandler,
  signInRequest,
  signOutRequest,
  signUpRequest,
  InventoryApiError,
  type StaffMember,
} from "./inventoryShared";

type AuthContextValue = {
  me: StaffMember | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
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

const AuthContext = createContext<AuthContextValue | null>(null);

// Owns the single source of truth for "who is signed in" via the ["me"] query.
// The server authenticates the web app through the httpOnly `rc_auth` cookie, so
// there is no token to store client-side — we just read /me. A 401 is the normal
// signed-out state (not an error), so we swallow it and treat it as "no user".
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<StaffMember | null> => {
      try {
        return await fetchMe();
      } catch (err) {
        if (err instanceof InventoryApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const me = data ?? null;

  // On every identity change we (a) write the new identity straight into ["me"]
  // from the auth response (mirroring mobile's setMe), and (b) drop every OTHER
  // cached query so one user's inventory/run/staff data can't leak into the next
  // session. We deliberately never destroy the ["me"] query itself: clearing it
  // makes its mounted observer fire a competing fetchMe() that races with — and
  // can clobber — the value we just set, which would bounce the user back to the
  // login screen (or, on sign-out, strand them in the authenticated shell).
  const resetCacheTo = useCallback(
    (identity: StaffMember | null) => {
      qc.setQueryData(["me"], identity);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
    [qc],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { user } = await signInRequest(username, password);
      resetCacheTo(user);
    },
    [resetCacheTo],
  );

  const signUp = useCallback(
    async (username: string, password: string) => {
      const { user } = await signUpRequest(username, password);
      resetCacheTo(user);
    },
    [resetCacheTo],
  );

  // Sign in as the seeded sandbox account. Credentials are intentionally the
  // well-known "test"/"test" pair — this is a non-production demo shortcut.
  const signInAsTest = useCallback(async () => {
    const { user } = await signInRequest("test", "test");
    resetCacheTo(user);
  }, [resetCacheTo]);

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } finally {
      resetCacheTo(null);
    }
  }, [resetCacheTo]);

  // Flip the app to the signed-out UI immediately. We set ["me"] to null rather
  // than clearing the whole cache so we don't disturb any in-flight request
  // (e.g. the daily-reset rollover's own sync push) — the next sign-in clears
  // the cache to prevent cross-user leakage.
  const forceSignedOut = useCallback(() => {
    qc.setQueryData(["me"], null);
  }, [qc]);

  const revalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  // Any 401 from an authenticated request means the session is gone (typically
  // the daily reset advanced the boundary) — bounce to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["me"], null);
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  // Changing a password doesn't rotate the session, so there's nothing to
  // refresh client-side — callers just surface success/failure.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changePasswordRequest(currentPassword, newPassword);
    },
    [],
  );

  // Persist the "Get Started" dismissal server-side, then write the updated
  // identity straight into the cache so the dialog won't auto-open again.
  const markOnboardingSeen = useCallback(async () => {
    const updated = await markOnboardingSeenRequest();
    qc.setQueryData(["me"], updated);
  }, [qc]);

  // Persist the guided-tour completion server-side, then write the updated
  // identity straight into the cache so the app knows this user finished it.
  const markTourCompleted = useCallback(async () => {
    const updated = await markTourCompletedRequest();
    qc.setQueryData(["me"], updated);
  }, [qc]);

  return (
    <AuthContext.Provider
      value={{
        me,
        isAuthenticated: me !== null,
        isLoading,
        signIn,
        signUp,
        signInAsTest,
        signOut,
        forceSignedOut,
        revalidate,
        changePassword,
        markOnboardingSeen,
        markTourCompleted,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
