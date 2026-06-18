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

  // Clearing the cache on every identity change prevents one user's cached
  // inventory/run/staff data from leaking into the next session.
  const signIn = useCallback(
    async (username: string, password: string) => {
      await signInRequest(username, password);
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    [qc],
  );

  const signUp = useCallback(
    async (username: string, password: string) => {
      await signUpRequest(username, password);
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } finally {
      qc.clear();
    }
  }, [qc]);

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
