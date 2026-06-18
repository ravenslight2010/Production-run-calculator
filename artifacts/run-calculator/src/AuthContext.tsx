import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePasswordRequest,
  fetchMe,
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
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
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

  // Changing a password doesn't rotate the session, so there's nothing to
  // refresh client-side — callers just surface success/failure.
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
        isAuthenticated: me !== null,
        isLoading,
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
