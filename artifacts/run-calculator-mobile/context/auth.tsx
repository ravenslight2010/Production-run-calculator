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

const TOKEN_KEY = "rc_auth_token";

type AuthContextValue = {
  me: StaffMember | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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

  // Register the token getter exactly once; it reads the ref each call so it
  // always returns the current token (or null when signed out).
  useEffect(() => {
    setAuthTokenGetter(() => Promise.resolve(tokenRef.current));
    return () => setAuthTokenGetter(null);
  }, []);

  const applyToken = useCallback(async (token: string | null) => {
    tokenRef.current = token;
    if (token) {
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
        if (!cancelled) setMe(user);
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
