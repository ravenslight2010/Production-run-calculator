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
import React, { useState } from "react";

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
import {
  SignUpPage,
  SignInPage,
  useUsernameAvailability,
  MIN_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "./auth";

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
    consumeFreshSession: vi.fn(() => false),
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
// Clear path: taken → field cleared entirely → idle hint, button still disabled
// ---------------------------------------------------------------------------
describe("sign-up button: clearing the username field after a taken result reverts to idle", () => {
  it(
    "shows the idle hint and keeps the button disabled when the username field is cleared after a taken result",
    async () => {
      const user = userEvent.setup();

      mockCheckUsernameAvailable.mockResolvedValue({ available: false });

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

      // Confirm the button is disabled while the username is taken.
      const submitButton = screen.getByRole("button", {
        name: /create.*account/i,
      });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);

      // Step 2: clear the field entirely — hook must snap back to "idle"
      // synchronously (handle.length === 0 branch fires in useEffect without
      // waiting for the debounce timer).
      await user.clear(usernameInput);

      // The idle hint ("At least 3 characters") must replace "already taken".
      // Neither "taken" nor "checking" should appear.
      // Use getAllByText because the password hint also says "At least 6 characters".
      // We verify at least one element matches the username-specific "3 characters" text.
      await waitFor(
        () => {
          expect(screen.getByText(/at least\s+3\s+characters/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );
      expect(screen.queryByText(/already taken/i)).toBeNull();
      expect(screen.queryByText(/checking availability/i)).toBeNull();

      // The button must remain disabled — the username is now empty so the
      // length guard blocks submission (right reason, not the "taken" status).
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    },
    8000,
  );
});

// ---------------------------------------------------------------------------
// Partial-clear path: taken → backspace to 1-2 chars → "short" hint, button disabled
// ---------------------------------------------------------------------------
describe("sign-up button: backspacing a taken username to below the minimum shows the 'short' hint", () => {
  it(
    "shows the 'At least 3 characters' hint and keeps the button disabled when the user backspaces a taken username down to 1-2 characters",
    async () => {
      const user = userEvent.setup();

      mockCheckUsernameAvailable.mockResolvedValue({ available: false });

      renderSignUpPage();

      // Fill all required fields other than username first.
      const pwFields = screen.getAllByLabelText(/password/i);
      await user.type(pwFields[0], "password123");
      await user.type(pwFields[1], "password123");
      await user.type(
        screen.getByLabelText(/facility.*code|access.*code/i),
        "valid-code",
      );

      // Step 1: type a taken username (≥3 chars so the hook fires) and wait
      // for the "already taken" hint.
      const usernameInput = screen.getByLabelText(/^username$/i);
      await user.type(usernameInput, "abc");

      await waitFor(
        () => {
          expect(screen.getByText(/already taken/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );

      // Confirm the button is disabled while the username is taken.
      const submitButton = screen.getByRole("button", {
        name: /create.*account/i,
      });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);

      // Step 2: backspace twice so only one character remains ("a").
      // The hook's length < MIN_USERNAME_LENGTH branch should fire synchronously
      // in the effect and set status → "short" without waiting for the debounce.
      await user.keyboard("{Backspace}{Backspace}");

      // The "short" hint ("At least 3 characters") must replace "already taken".
      // Neither "taken" nor "checking" should appear.
      await waitFor(
        () => {
          expect(screen.getByText(/at least\s+3\s+characters/i)).toBeTruthy();
        },
        { timeout: 1500 },
      );
      expect(screen.queryByText(/already taken/i)).toBeNull();
      expect(screen.queryByText(/checking availability/i)).toBeNull();

      // The button must remain disabled — the username is now too short so the
      // length guard blocks submission (right reason, not the "taken" status).
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);
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

// ---------------------------------------------------------------------------
// Guard proof: availability check fires when enabled is forced to true
//
// This is the companion to the sign-in tests above. Those tests prove the
// mock is NEVER called when the hook runs with enabled=false (the sign-in
// guard). This test proves the mock IS called when the same hook runs with
// enabled=true — isolating the guard as the load-bearing suppressor, not an
// accidental gap in the mock setup.
//
// A tiny test component exercises useUsernameAvailability directly with
// enabled hardcoded to true, simulating what would happen if a future
// refactor accidentally removed the isSignUp gate in AuthForm.
// ---------------------------------------------------------------------------

/** Minimal harness that exercises useUsernameAvailability with enabled=true. */
function AvailabilityHookHarness({
  initialUsername,
}: {
  initialUsername: string;
}) {
  const [username, setUsername] = useState(initialUsername);
  const status = useUsernameAvailability(username, /* enabled= */ true);
  return (
    <div>
      <input
        aria-label="username-field"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <span data-testid="status">{status}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Short-username branch: enabled=true + 1–2 char username → "short", no API call
//
// This test directly exercises the hook's MIN_USERNAME_LENGTH guard via the
// exported hook (through AvailabilityHookHarness). If the branch is removed
// or its threshold is widened, the status will advance to "checking" and
// eventually call the mock — making this test fail immediately.
// ---------------------------------------------------------------------------
describe("short-username branch: status is 'short' and no API call is made when enabled=true but username is below the minimum length", () => {
  // Derive boundary inputs from the exported constant so that if
  // MIN_USERNAME_LENGTH changes, the probed values shift with it and the tests
  // continue to exercise the correct boundary rather than passing vacuously.
  const twoBelow = "a".repeat(MIN_USERNAME_LENGTH - 2); // MIN_USERNAME_LENGTH - 2 chars (≥ 1 when MIN ≥ 3)
  const oneBelow = "a".repeat(MIN_USERNAME_LENGTH - 1); // MIN_USERNAME_LENGTH - 1 chars — highest "short" value
  const atMin = "a".repeat(MIN_USERNAME_LENGTH); // exactly MIN_USERNAME_LENGTH chars — first "ok" value

  it(
    `sets status to 'short' and never calls checkUsernameAvailable for a ${MIN_USERNAME_LENGTH - 2}-character username with enabled=true`,
    async () => {
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      render(<AvailabilityHookHarness initialUsername={twoBelow} />);

      // The hook must set status → "short" synchronously in the first effect
      // run (before the debounce timer) because the username is below MIN_USERNAME_LENGTH.
      await waitFor(
        () => {
          expect(
            (screen.getByTestId("status") as HTMLElement).textContent,
          ).toBe("short");
        },
        { timeout: 1000 },
      );

      // Wait well past the 400 ms debounce window to confirm the API is never reached.
      await new Promise((resolve) => setTimeout(resolve, 700));

      // The short-circuit must have prevented any network call.
      expect(mockCheckUsernameAvailable).not.toHaveBeenCalled();
    },
    4000,
  );

  it(
    `sets status to 'short' and never calls checkUsernameAvailable for a ${MIN_USERNAME_LENGTH - 1}-character username with enabled=true`,
    async () => {
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      render(<AvailabilityHookHarness initialUsername={oneBelow} />);

      await waitFor(
        () => {
          expect(
            (screen.getByTestId("status") as HTMLElement).textContent,
          ).toBe("short");
        },
        { timeout: 1000 },
      );

      // Wait well past the debounce to confirm the API is never invoked.
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(mockCheckUsernameAvailable).not.toHaveBeenCalled();
    },
    4000,
  );

  it(
    `transitions from 'short' to 'checking' (and eventually calls the API) when the username is extended to exactly ${MIN_USERNAME_LENGTH} characters`,
    async () => {
      const user = userEvent.setup();
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      render(<AvailabilityHookHarness initialUsername={oneBelow} />);

      // Start in "short" state.
      await waitFor(
        () => {
          expect(
            (screen.getByTestId("status") as HTMLElement).textContent,
          ).toBe("short");
        },
        { timeout: 1000 },
      );

      // Extend the username to exactly MIN_USERNAME_LENGTH characters — the minimum.
      // Type the same character used to build oneBelow so the result equals atMin.
      await user.type(screen.getByLabelText("username-field"), "a");

      // The hook must now advance to "checking" and eventually call the API.
      await waitFor(
        () => {
          expect(mockCheckUsernameAvailable).toHaveBeenCalledWith(atMin);
        },
        { timeout: 1500 },
      );

      // Status must settle to "available" once the mock resolves.
      await waitFor(
        () => {
          expect(
            (screen.getByTestId("status") as HTMLElement).textContent,
          ).toBe("available");
        },
        { timeout: 1000 },
      );
    },
    6000,
  );
});

describe("sign-in guard: availability check fires when the guard is bypassed (enabled forced to true)", () => {
  it(
    "calls checkUsernameAvailable after the debounce when enabled is forced to true — proving the guard is the load-bearing suppressor on sign-in",
    async () => {
      const user = userEvent.setup();

      // Resolve immediately so no pending promises linger after the test.
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      // Render the harness with a valid username already in place so the hook
      // enters "checking" state right away and fires the debounce timer.
      render(
        <AvailabilityHookHarness initialUsername="newstaff" />,
      );

      // The hook sets status → "checking" synchronously in the first effect
      // run (before the 400 ms timer fires).
      await waitFor(
        () => {
          expect(
            (screen.getByTestId("status") as HTMLElement).textContent,
          ).toBe("checking");
        },
        { timeout: 1000 },
      );

      // After the debounce fires the mock must have been called — the hook is
      // not guarded by enabled=false here, so nothing suppresses the call.
      await waitFor(
        () => {
          expect(mockCheckUsernameAvailable).toHaveBeenCalledWith("newstaff");
        },
        { timeout: 1500 },
      );

      // Status must resolve to "available" once the mock settles, confirming
      // the full round-trip completes when enabled=true.
      await waitFor(
        () => {
          expect(
            (screen.getByTestId("status") as HTMLElement).textContent,
          ).toBe("available");
        },
        { timeout: 1000 },
      );
    },
    6000,
  );

  it(
    "does NOT call checkUsernameAvailable when enabled is false — confirming the sign-in guard is what prevents the call (not the mock setup)",
    async () => {
      // Re-verify the negative side of the guard using the same hook directly.
      // Typing on the sign-in page is equivalent to enabled=false here.
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      render(
        <AvailabilityHookHarness initialUsername="" />,
      );

      // Render a second harness with enabled forced to false to mirror sign-in.
      // We do this via the exported hook called in a separate component.
      function DisabledHarness() {
        const status = useUsernameAvailability("newstaff", /* enabled= */ false);
        return <span data-testid="disabled-status">{status}</span>;
      }

      const { unmount } = render(<DisabledHarness />);

      // Wait well past the debounce window — the mock must never fire.
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(mockCheckUsernameAvailable).not.toHaveBeenCalled();

      // Status must remain "idle" — the guard short-circuits the hook.
      expect(
        (screen.getByTestId("disabled-status") as HTMLElement).textContent,
      ).toBe("idle");

      unmount();
    },
    4000,
  );
});

// ---------------------------------------------------------------------------
// Password hint: rendered text must contain the MIN_PASSWORD_LENGTH value
//
// The PasswordHint component inside SignUpPage renders "At least N characters"
// where N is derived from the MIN_PASSWORD_LENGTH constant. If the constant is
// bumped but the hard-coded string is not updated (or vice-versa), this test
// catches it immediately because it reads the exported constant and matches
// against the rendered output — they must agree.
// ---------------------------------------------------------------------------
describe("password hint: rendered text matches the MIN_PASSWORD_LENGTH constant", () => {
  it(
    "sign-up page renders a password hint containing the exact MIN_PASSWORD_LENGTH value",
    async () => {
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      renderSignUpPage();

      // The PasswordHint is always visible on the sign-up page (it shows once
      // the password field exists in the DOM). Find any element whose text
      // includes "At least <N> characters" where N equals MIN_PASSWORD_LENGTH.
      // Using a regex anchored to the exported constant's numeric value means
      // bumping the constant without updating the JSX causes an immediate failure.
      const expectedPattern = new RegExp(
        `at least\\s+${MIN_PASSWORD_LENGTH}\\s+characters`,
        "i",
      );

      await waitFor(
        () => {
          expect(screen.getByText(expectedPattern)).toBeTruthy();
        },
        { timeout: 1500 },
      );
    },
    4000,
  );

  it(
    "counter-proof: a pattern for a DIFFERENT length does not match the rendered hint",
    () => {
      mockCheckUsernameAvailable.mockResolvedValue({ available: true });

      renderSignUpPage();

      // If the rendered hint matches a wrong length, our primary assertion
      // above would be vacuously passing against an anything-goes element.
      // This counter-proof confirms specificity: a pattern for MIN_PASSWORD_LENGTH+1
      // must NOT appear in the rendered output.
      const wrongLengthPattern = new RegExp(
        `at least\\s+${MIN_PASSWORD_LENGTH + 1}\\s+characters`,
        "i",
      );

      expect(screen.queryByText(wrongLengthPattern)).toBeNull();
    },
  );
});
