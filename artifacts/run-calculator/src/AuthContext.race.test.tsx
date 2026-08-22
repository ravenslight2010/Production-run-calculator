// @vitest-environment jsdom
//
// A cold page starts its /me probe before the user submits sign-in. This
// regression holds that probe open, signs in a manager, then delivers both a
// late old-epoch unauthorized callback and the original 401. Neither may
// replace the identity returned by sign-in.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StaffMember } from "./inventoryShared";

const mocks = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  signInRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  setAuthRequestEpoch: vi.fn(),
}));

vi.mock("./inventoryShared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inventoryShared")>();
  return {
    ...actual,
    fetchMe: mocks.fetchMe,
    signInRequest: mocks.signInRequest,
    setUnauthorizedHandler: mocks.setUnauthorizedHandler,
    setAuthRequestEpoch: mocks.setAuthRequestEpoch,
  };
});

import { AuthProvider } from "./AuthContext";
import { InventoryApiError } from "./inventoryShared";
import { useAuth } from "./useAuth";

const manager: StaffMember = {
  userId: "manager-1",
  role: "manager",
  capabilities: ["manage-staff", "review-incidents"],
  email: null,
  name: "Manager",
  onboardingSeen: true,
  tourCompleted: true,
  floorModeEnabled: false,
  notificationPrefs: {},
  sandbox: false,
  sandboxCopiedAt: null,
  sandboxStale: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function IdentityProbe() {
  const { me, signIn } = useAuth();
  return (
    <>
      <output data-testid="identity">{me?.userId ?? "signed-out"}</output>
      <button type="button" onClick={() => void signIn("manager", "password")}>
        Sign in
      </button>
    </>
  );
}

function renderAuth() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <IdentityProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return qc;
}

afterEach(() => {
  cleanup();
  mocks.fetchMe.mockReset();
  mocks.signInRequest.mockReset();
  mocks.setUnauthorizedHandler.mockReset();
  mocks.setAuthRequestEpoch.mockReset();
});

describe("AuthProvider session transition", () => {
  it("keeps a sign-in identity when the cold /me probe and a stale 401 settle late", async () => {
    const initialProbe = deferred<StaffMember>();
    mocks.fetchMe.mockReturnValueOnce(initialProbe.promise);
    mocks.signInRequest.mockResolvedValue({ token: "ignored", user: manager });

    renderAuth();
    await waitFor(() => expect(mocks.fetchMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.setUnauthorizedHandler).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("manager-1");

    const unauthorizedHandler = mocks.setUnauthorizedHandler.mock.calls.at(-1)?.[0] as
      | ((epoch: number) => void)
      | undefined;
    expect(unauthorizedHandler).toBeTypeOf("function");
    unauthorizedHandler?.(0);

    initialProbe.reject(new InventoryApiError(401, "Unauthorized", null, null));
    await waitFor(() =>
      expect(screen.getByTestId("identity").textContent).toBe("manager-1"),
    );
    expect(mocks.fetchMe).toHaveBeenCalledTimes(1);
  });
});