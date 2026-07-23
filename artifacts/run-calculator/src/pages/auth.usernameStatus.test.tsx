// @vitest-environment jsdom
//
// Tests that the sign-up submit button stays disabled while the username
// availability check is in-flight ("checking") and after the server confirms
// the username is "taken". Also confirms the sign-in button is unaffected.
//
// Strategy:
//  - "checking": the hook sets usernameStatus → "checking" synchronously in
//    useEffect (before the 400 ms debounce timer fires). We waitFor the
//    "Checking availability…" spinner, assert the button is disabled at that
//    point, then also wait for the mock to be called (proof the debounce
//    fired) and assert it is still disabled while the fetch is in-flight.
//    The mock resolves immediately after being called so there is no
//    never-resolving promise to leak.
//  - "taken": checkUsernameAvailable resolves with { available: false };
//    we waitFor the "already taken" hint then assert the button is disabled.
//  - sign-in: availability hook is disabled in sign-in mode; the button
//    only gates on `submitting` and starts enabled.
//
// Uses real timers throughout (fake-timer + userEvent combos deadlock with
// the 400 ms debounce in this setup).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// wouter must be mocked before importing auth.tsx so useLocation resolves.
vi.mock("wouter", () => ({
  useLocation: () => ["/sign-up", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// We control checkUsernameAvailable per-test via the mock implementation.
const mockCheckUsernameAvailable = vi.fn();
vi.mock("@/inventoryShared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/inventoryShared")>();
  return {
    ...actual,
    checkUsernameAvailable: (...args: unknown[]) =>
      mockCheckUsernameAvailable(...args),
  };
});

import { AuthContext, type AuthContextValue } from "@/useAuth";
import { SignUpPage, SignInPage } from "./auth";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeAuthValue(): AuthContextValue {
  return {
    me: null,
    isAuthenticated: false,
    isLoading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
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

function renderSignUpPage() {
  return render(
    <AuthContext.Provider value={makeAuthValue()}>
      <SignUpPage />
    </AuthContext.Provider>,
  );
}

function renderSignInPage() {
  return render(
    <AuthContext.Provider value={makeAuthValue()}>
      <SignInPage />
    </AuthContext.Provider>,
  );
}

// ---------------------------------------------------------------------------
// "checking" state: button must be disabled while fetch is in-flight
// ---------------------------------------------------------------------------
describe("sign-up button: disabled while availability check is in-flight", () => {
  it(
    "disables the submit button while the availability fetch is pending",
    async () => {
      const user = userEvent.setup();

      // The mock resolves with "available" once called. We use a deferred
      // resolve so we can assert the button is disabled BEFORE the check
      // settles, then let it resolve cleanly at the end of the test.
      let resolveCheck!: (v: { available: boolean }) => void;
      const checkPromise = new Promise<{ available: boolean }>((resolve) => {
        resolveCheck = resolve;
      });
      mockCheckUsernameAvailable.mockReturnValue(checkPromise);

      renderSignUpPage();

      // Fill all other required fields first so only usernameStatus blocks.
      const pwFields = screen.getAllByLabelText(/password/i);
      await user.type(pwFields[0], "password123");
      await user.type(pwFields[1], "password123");
      await user.type(
        screen.getByLabelText(/facility.*code|access.*code/i),
        "valid-code",
      );

      // Type a valid username (≥3 chars). The hook sets status → "checking"
      // synchronously in useEffect, before the 400 ms debounce timer fires.
      await user.type(screen.getByLabelText(/^username$/i), "newstaff");

      // The spinner hint proves usernameStatus is "checking" (set synchronously
      // in useEffect before the timer fires — appears fast, no need to wait
      // for the 400 ms debounce).
      await waitFor(
        () => {
          expect(screen.getByText(/checking availability/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );

      // 1) Button is disabled as soon as the "checking" hint appears.
      const submitButton = screen.getByRole("button", {
        name: /create.*account/i,
      });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);

      // 2) Wait for the debounce to fire (mock gets called) — button must
      //    stay disabled while the promise is still pending.
      await waitFor(
        () => {
          expect(mockCheckUsernameAvailable).toHaveBeenCalled();
        },
        { timeout: 1500 },
      );
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);

      // Resolve the deferred promise so React state settles cleanly before
      // cleanup runs — avoids act() warnings on unmount.
      resolveCheck({ available: true });
      await waitFor(
        () => {
          expect(screen.getByText(/username is available/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );
    },
    8000,
  );
});

// ---------------------------------------------------------------------------
// "taken" state: button must remain disabled after the check returns taken
// ---------------------------------------------------------------------------
describe("sign-up button: disabled when username is taken", () => {
  it(
    "disables the submit button after checkUsernameAvailable returns available:false",
    async () => {
      const user = userEvent.setup();

      mockCheckUsernameAvailable.mockResolvedValue({ available: false });

      renderSignUpPage();

      // Type the username first so the hint text appears when we assert.
      await user.type(screen.getByLabelText(/^username$/i), "takenuser");

      // Fill the remaining required fields.
      const pwFields = screen.getAllByLabelText(/password/i);
      await user.type(pwFields[0], "password123");
      await user.type(pwFields[1], "password123");
      await user.type(
        screen.getByLabelText(/facility.*code|access.*code/i),
        "valid-code",
      );

      // Wait for the "already taken" hint — debounce fired, check resolved.
      await waitFor(
        () => {
          expect(screen.getByText(/already taken/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );

      // All other fields are satisfied — usernameStatus === "taken" is the
      // only remaining blocker.
      const submitButton = screen.getByRole("button", {
        name: /create.*account/i,
      });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    },
    6000,
  );
});

// ---------------------------------------------------------------------------
// Recovery path: taken → corrected to available → button re-enables
// ---------------------------------------------------------------------------
describe("sign-up button: re-enables after correcting a taken username", () => {
  it(
    "re-enables the submit button when the user fixes a taken username to an available one",
    async () => {
      const user = userEvent.setup();

      // First call (taken username) resolves taken; second call (corrected
      // username) resolves available.
      mockCheckUsernameAvailable
        .mockResolvedValueOnce({ available: false })
        .mockResolvedValueOnce({ available: true });

      renderSignUpPage();

      // Fill all required fields other than username first.
      const pwFields = screen.getAllByLabelText(/password/i);
      await user.type(pwFields[0], "password123");
      await user.type(pwFields[1], "password123");
      await user.type(
        screen.getByLabelText(/facility.*code|access.*code/i),
        "valid-code",
      );

      // Step 1: type a taken username and wait for the "already taken" hint.
      const usernameInput = screen.getByLabelText(/^username$/i);
      await user.type(usernameInput, "takenuser");

      await waitFor(
        () => {
          expect(screen.getByText(/already taken/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );

      // Button must be disabled while the username is taken.
      const submitButton = screen.getByRole("button", {
        name: /create.*account/i,
      });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);

      // Step 2: clear the field and type an available username.
      await user.clear(usernameInput);
      await user.type(usernameInput, "newstaff");

      // Wait for the "Username is available" hint — debounce fired and the
      // second mock resolved with available: true.
      await waitFor(
        () => {
          expect(screen.getByText(/username is available/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );

      // All fields are satisfied and usernameStatus is now "available" — the
      // button must be re-enabled.
      expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    },
    8000,
  );
});

// ---------------------------------------------------------------------------
// Sign-in button: must NOT be gated on username availability at all
// ---------------------------------------------------------------------------
describe("sign-in button: unaffected by username availability", () => {
  it(
    "sign-in submit button is enabled by default and stays enabled after typing a username",
    async () => {
      const user = userEvent.setup();

      renderSignInPage();

      const submitButton = screen.getByRole("button", { name: /^sign in$/i });

      // Initially enabled — only `submitting` can disable the sign-in button.
      expect((submitButton as HTMLButtonElement).disabled).toBe(false);

      // Typing a username in sign-in mode must not invoke the availability
      // check (hook is disabled when mode !== "sign-up").
      await user.type(screen.getByLabelText(/^username$/i), "anyuser");

      expect((submitButton as HTMLButtonElement).disabled).toBe(false);
      expect(mockCheckUsernameAvailable).not.toHaveBeenCalled();
    },
    6000,
  );

  it(
    "availability check is never invoked even after the full debounce window elapses on sign-in",
    async () => {
      const user = userEvent.setup();

      renderSignInPage();

      // Type a long valid username — well above the ≥3 char minimum that would
      // trigger the availability hook on sign-up.
      await user.type(
        screen.getByLabelText(/^username$/i),
        "longusernameinput",
      );

      // Wait well past the 400 ms debounce window so that any accidentally-
      // enabled hook would have had time to fire and call the mock.
      await new Promise((resolve) => setTimeout(resolve, 700));

      // The availability hook must never have been invoked in sign-in mode,
      // even after the debounce period. This catches a future refactor that
      // accidentally passes `enabled: true` to the hook on the sign-in page.
      expect(mockCheckUsernameAvailable).not.toHaveBeenCalled();
    },
    6000,
  );
});
