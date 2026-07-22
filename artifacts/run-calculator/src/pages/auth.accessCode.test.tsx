// @vitest-environment jsdom
//
// Component tests verifying that the sign-up form surfaces the correct
// "Incorrect facility code" message when the server rejects the submitted code
// with a 403.
//
// The test renders the real SignUpPage component (exported from auth.tsx) with a
// minimal harness: wouter's router, the AuthContext, and a stub
// checkUsernameAvailable are all mocked so no real network requests are made.
// The signUp function in the auth context is replaced with a spy that throws an
// InventoryApiError(403, ...) to simulate the server's rejection.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// wouter must be mocked before importing auth.tsx so useLocation resolves.
vi.mock("wouter", () => ({
  useLocation: () => ["/sign-up", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// Stub checkUsernameAvailable so the debounced availability check never fires a
// real request. The rest of inventoryShared is kept as-is.
vi.mock("@/inventoryShared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/inventoryShared")>();
  return {
    ...actual,
    checkUsernameAvailable: vi.fn().mockResolvedValue({ available: true }),
  };
});

import { InventoryApiError } from "@/inventoryShared";
import { AuthContext, type AuthContextValue } from "@/useAuth";
import { SignUpPage } from "./auth";

afterEach(() => cleanup());

// Build a minimal AuthContext value where every function is a no-op stub
// EXCEPT signUp, which is replaced per-test.
function makeAuthValue(
  signUp: AuthContextValue["signUp"],
): AuthContextValue {
  return {
    me: null,
    isAuthenticated: false,
    isLoading: false,
    signIn: vi.fn(),
    signUp,
    signInAsTest: vi.fn(),
    signOut: vi.fn(),
    forceSignedOut: vi.fn(),
    revalidate: vi.fn(),
    changePassword: vi.fn(),
    markOnboardingSeen: vi.fn(),
    markTourCompleted: vi.fn(),
    setFloorModeEnabled: vi.fn(),
    setNotificationPrefs: vi.fn(),
  };
}

function renderSignUpPage(authValue: AuthContextValue) {
  return render(
    <AuthContext.Provider value={authValue}>
      <SignUpPage />
    </AuthContext.Provider>,
  );
}

describe("sign-up form: incorrect facility code error", () => {
  it("shows 'Incorrect facility code' when the server returns 403", async () => {
    const user = userEvent.setup();

    const signUp = vi.fn().mockRejectedValue(
      new InventoryApiError(403, "Incorrect facility code.", null, "Incorrect facility code."),
    );
    renderSignUpPage(makeAuthValue(signUp));

    // Fill in valid-looking fields so the client-side guards don't fire.
    await user.type(screen.getByLabelText(/username/i), "newstaff");
    // Password and confirm-password fields.
    const pwFields = screen.getAllByLabelText(/password/i);
    await user.type(pwFields[0], "password123");
    await user.type(pwFields[1], "password123");
    // Facility code field.
    await user.type(screen.getByLabelText(/facility.*code|access.*code/i), "wrong-code");

    await user.click(screen.getByRole("button", { name: /create.*account|sign.*up/i }));

    // The server error must be surfaced; the client must NOT show a generic
    // fallback — the specific "Incorrect facility code" copy is what operators
    // see when they mistype the onboarding secret.
    await waitFor(() => {
      expect(
        screen.getByText(/incorrect facility code/i),
      ).toBeTruthy();
    });
  });

  it("does NOT show the facility-code error for a sign-in 401 (wrong username/password)", async () => {
    // Sanity check: the 403 branch is specific to sign-up; sign-in reuses the
    // same form in a different mode. If we were on the sign-in page and got a
    // 401, we should NOT see the facility-code message.
    // This test renders SignUpPage (sign-up mode) and verifies that a 401 from
    // signUp doesn't accidentally show the facility-code copy.
    const user = userEvent.setup();

    const signUp = vi.fn().mockRejectedValue(
      new InventoryApiError(401, "Unauthorized", null, null),
    );
    renderSignUpPage(makeAuthValue(signUp));

    await user.type(screen.getByLabelText(/username/i), "newstaff");
    const pwFields = screen.getAllByLabelText(/password/i);
    await user.type(pwFields[0], "password123");
    await user.type(pwFields[1], "password123");
    await user.type(screen.getByLabelText(/facility.*code|access.*code/i), "any-code");

    await user.click(screen.getByRole("button", { name: /create.*account|sign.*up/i }));

    await waitFor(() => {
      expect(screen.queryByText(/incorrect facility code/i)).toBeNull();
    });
  });
});
