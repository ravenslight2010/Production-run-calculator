// Mobile auth: self-contained username + password sessions.
//
// The server returns an opaque HMAC-signed session token on sign-in/up. Native
// has no browser cookie jar, so we persist that token in expo-secure-store and
// replay it as a bearer header on every API/SSE call via setAuthTokenGetter
// (the same getter the inventory REST client, sync SSE stream, and AI optimize
// endpoint already read). On launch we restore the token and validate it with
// /me; a 401 means the session is gone and we drop back to signed-out.

import { setAuthTokenGetter } from "@workspace/api-client-react";
import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  changePasswordRequest,
  fetchMe,
  signInRequest,
  signOutRequest,
  signUpRequest,
  InventoryApiError,
  type StaffMember,
} from "./inventoryShared";
import { setUnauthorizedHandler } from "./authEvents";

const TOKEN_KEY = "rc_auth_token";

type AuthContextValue = {
  me: StaffMember | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Drop straight to the signed-out UI without discarding the token. Used by the
  // daily-reset rollover so the token survives long enough for the rollover's own
  // sync push to land (the server boundary then invalidates it).
  forceSignedOut: () => void;
  // Re-check the session against the server (used when the SSE stream errors,
  // which can mean the daily reset just signed us out).
  revalidate: () => void;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<StaffMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // The getter must read the live token, so keep it in a ref the closure sees.
  const tokenRef = useRef<string | null>(null);

  // Latch set by the daily-reset proactive sign-out (forceSignedOut). It keeps
  // the in-flight launch restore and SSE revalidation from signing the user back
  // in during the window after the reset but before the server boundary takes
  // effect (the boundary read is cached briefly server-side). Cleared whenever a
  // real token is applied on a fresh sign-in.
  const forcedOutRef = useRef(false);

  // Register the token getter exactly once; it reads the ref each call so it
  // always returns the current token (or null when signed out).
  useEffect(() => {
    setAuthTokenGetter(() => Promise.resolve(tokenRef.current));
    return () => setAuthTokenGetter(null);
  }, []);

  const applyToken = useCallback(async (token: string | null) => {
    tokenRef.current = token;
    if (token) {
      forcedOutRef.current = false; // a real sign-in clears the reset latch
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  }, []);

  // Restore a persisted session on launch and validate it against the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!stored) return;
        tokenRef.current = stored;
        const user = await fetchMe();
        if (!cancelled && !forcedOutRef.current) setMe(user);
      } catch (err) {
        // 401 (or any failure) → treat as signed out and discard the token.
        tokenRef.current = null;
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        if (
          !cancelled &&
          !(err instanceof InventoryApiError && err.status === 401)
        ) {
          // Non-auth failures (e.g. offline) also land here; staying signed out
          // is the safe default and the user can retry sign-in.
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { token, user } = await signInRequest(username, password);
      await applyToken(token);
      setMe(user);
    },
    [applyToken],
  );

  const signUp = useCallback(
    async (username: string, password: string) => {
      const { token, user } = await signUpRequest(username, password);
      await applyToken(token);
      setMe(user);
    },
    [applyToken],
  );

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } catch {
      // Best-effort server-side; we always clear the local session below.
    } finally {
      await applyToken(null);
      setMe(null);
    }
  }, [applyToken]);

  // Flip to the signed-out UI immediately while keeping the token, so an
  // in-flight request (e.g. the daily-reset rollover's own sync push) can still
  // authenticate. The server boundary invalidates the token for real; on the
  // next launch the /me restore probe 401s and discards it.
  const forceSignedOut = useCallback(() => {
    forcedOutRef.current = true;
    setMe(null);
  }, []);

  const revalidate = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const user = await fetchMe();
      if (!forcedOutRef.current) setMe(user);
    } catch (err) {
      if (err instanceof InventoryApiError && err.status === 401) {
        await applyToken(null);
        setMe(null);
      }
      // Non-auth failures (offline, etc.) leave the session as-is.
    }
  }, [applyToken]);

  // A 401 on an already-signed-in request means the session is gone (typically
  // the daily reset advanced the boundary) — discard the token and show login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void applyToken(null);
      setMe(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [applyToken]);

  // Changing a password doesn't rotate the session token, so the stored token
  // stays valid — nothing to update locally beyond surfacing success/failure.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changePasswordRequest(currentPassword, newPassword);
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        me,
        isLoading,
        isAuthenticated: me !== null,
        signIn,
        signUp,
        signOut,
        forceSignedOut,
        revalidate,
        changePassword,
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
