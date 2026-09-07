import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePasswordRequest,
  fetchMe,
  markOnboardingSeenRequest,
  markTourCompletedRequest,
  setFloorModeRequest,
  setAuthRequestEpoch,
  setNotificationPrefsRequest,
  setUnauthorizedHandler,
  signInRequest,
  signOutRequest,
  signUpRequest,
  InventoryApiError,
  type StaffMember,
} from "./inventoryShared";
import { AuthContext } from "./useAuth";
import { resetMasterDataTransportCache } from "./masterData";

// NOTE: the raw context object and `useAuth` live in ./useAuth.ts so this file
// exports ONLY a component. Mixing them here broke React Fast Refresh's
// boundary rule: an HMR partial reload could instantiate this module twice,
// giving the mounted Provider and `useAuth` two DIFFERENT context objects and
// crashing consumers with "useAuth must be used within an AuthProvider".
// Keep any future non-component exports in ./useAuth.ts (or another module).

// Owns the single source of truth for "who is signed in" via the ["me"] query.
// The server authenticates the web app through the httpOnly `rc_auth` cookie, so
// there is no token to store client-side — we just read /me. A 401 is the normal
// signed-out state (not an error), so we swallow it and treat it as "no user".
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const authEpochRef = useRef(0);
  const freshSessionRef = useRef(false);

  const advanceAuthEpoch = useCallback(() => {
    const next = authEpochRef.current + 1;
    authEpochRef.current = next;
    setAuthRequestEpoch(next);
    return next;
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async ({ signal }): Promise<StaffMember | null> => {
      const requestEpoch = authEpochRef.current;
      try {
        const user = await fetchMe(signal);
        // A request that began under a previous session transition is no
        // longer allowed to become the identity source. The current cache is
        // authoritative (and may already contain the sign-in response).
        if (requestEpoch !== authEpochRef.current) {
          return qc.getQueryData<StaffMember | null>(["me"]) ?? null;
        }
        return user;
      } catch (err) {
        if (requestEpoch !== authEpochRef.current) {
          return qc.getQueryData<StaffMember | null>(["me"]) ?? null;
        }
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
    async (identity: StaffMember | null) => {
      // Stop the mounted identity observer from letting an older /me request
      // write over the response from sign-in/sign-out. The request also
      // carries the epoch guard above for fetch implementations that do not
      // honor AbortSignal.
      await qc.cancelQueries({ queryKey: ["me"], exact: true });
      resetMasterDataTransportCache();
      qc.setQueryData(["me"], identity);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
    [qc],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      const transitionEpoch = advanceAuthEpoch();
      const { user } = await signInRequest(username, password);
      if (transitionEpoch !== authEpochRef.current) return;
      freshSessionRef.current = true;
      await resetCacheTo(user);
    },
    [advanceAuthEpoch, resetCacheTo],
  );

  const signUp = useCallback(
    async (username: string, password: string, accessCode: string) => {
      const transitionEpoch = advanceAuthEpoch();
      const { user } = await signUpRequest(username, password, accessCode);
      if (transitionEpoch !== authEpochRef.current) return;
      freshSessionRef.current = true;
      await resetCacheTo(user);
    },
    [advanceAuthEpoch, resetCacheTo],
  );

  // Sign in as the seeded sandbox account. Credentials are intentionally the
  // well-known "test"/"test" pair — this is a non-production demo shortcut.
  const signInAsTest = useCallback(async () => {
    const transitionEpoch = advanceAuthEpoch();
    const { user } = await signInRequest("test", "test");
    if (transitionEpoch !== authEpochRef.current) return;
    freshSessionRef.current = true;
    await resetCacheTo(user);
  }, [advanceAuthEpoch, resetCacheTo]);

  const signOut = useCallback(async () => {
    const transitionEpoch = advanceAuthEpoch();
    freshSessionRef.current = false;
    try {
      await signOutRequest();
    } finally {
      if (transitionEpoch === authEpochRef.current) await resetCacheTo(null);
    }
  }, [advanceAuthEpoch, resetCacheTo]);

  // Flip the app to the signed-out UI immediately. We set ["me"] to null rather
  // than clearing the whole cache so we don't disturb any in-flight request
  // (e.g. the daily-reset rollover's own sync push) — the next sign-in clears
  // the cache to prevent cross-user leakage.
  const forceSignedOut = useCallback(() => {
    advanceAuthEpoch();
    freshSessionRef.current = false;
    resetMasterDataTransportCache();
    qc.setQueryData(["me"], null);
  }, [advanceAuthEpoch, qc]);

  const consumeFreshSession = useCallback(() => {
    const wasFresh = freshSessionRef.current;
    freshSessionRef.current = false;
    return wasFresh;
  }, []);

  const revalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  // A 401 on an authenticated request usually means the session ended (the daily
  // reset advanced the boundary). But it can also be a STALE request that was
  // already in flight when the user signed in and only resolved afterward —
  // hard-nulling ["me"] here would bounce the just-logged-in user straight back
  // to the login screen (the "had to sign in 3×" symptom). So instead of nulling
  // blindly, re-probe the session: invalidating ["me"] refetches /me, whose
  // queryFn maps a real 401 to null (signed out) but keeps the user when the
  // session is actually still valid. /me is a session-probe path, so its own 401
  // can't re-enter this handler (no loop).
  useEffect(() => {
    setAuthRequestEpoch(authEpochRef.current);
    setUnauthorizedHandler((requestEpoch) => {
      // Ignore 401s from requests that started before the latest auth
      // transition. A current-epoch 401 still re-probes /me and can sign the
      // user out when the server session has genuinely expired.
      if (requestEpoch !== authEpochRef.current) return;
      void qc.invalidateQueries({ queryKey: ["me"] });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  // Changing a password invalidates every previously-issued session token —
  // including the one that authenticated this very request — so the server
  // mints and returns a fresh one. Apply it the same way sign-in does or the
  // user would be logged out by their own password change.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const transitionEpoch = advanceAuthEpoch();
      const { user } = await changePasswordRequest(currentPassword, newPassword);
      if (transitionEpoch !== authEpochRef.current) return;
      await resetCacheTo(user);
    },
    [advanceAuthEpoch, resetCacheTo],
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

  // Persist the Floor Mode on/off preference server-side so it follows the
  // user across devices. Optimistic: flip the cached identity immediately so
  // the toggle feels instant, then reconcile with the server's response; on
  // failure re-probe /me so the UI falls back to the server's truth.
  const setFloorModeEnabled = useCallback(
    async (enabled: boolean) => {
      qc.setQueryData(["me"], (prev: StaffMember | null | undefined) =>
        prev ? { ...prev, floorModeEnabled: enabled } : prev,
      );
      try {
        const updated = await setFloorModeRequest(enabled);
        qc.setQueryData(["me"], updated);
      } catch (err) {
        void qc.invalidateQueries({ queryKey: ["me"] });
        throw err;
      }
    },
    [qc],
  );

  // Merge per-alert notification toggles into the user's server-side
  // preferences. Optimistic like Floor Mode: merge into the cached identity
  // immediately so switches feel instant, then reconcile with the server's
  // response; on failure re-probe /me so the UI falls back to the truth.
  const setNotificationPrefs = useCallback(
    async (prefs: Record<string, boolean>) => {
      qc.setQueryData(["me"], (prev: StaffMember | null | undefined) =>
        prev
          ? { ...prev, notificationPrefs: { ...prev.notificationPrefs, ...prefs } }
          : prev,
      );
      try {
        const updated = await setNotificationPrefsRequest(prefs);
        qc.setQueryData(["me"], updated);
      } catch (err) {
        void qc.invalidateQueries({ queryKey: ["me"] });
        throw err;
      }
    },
    [qc],
  );

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
        consumeFreshSession,
        revalidate,
        changePassword,
        markOnboardingSeen,
        markTourCompleted,
        setFloorModeEnabled,
        setNotificationPrefs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
