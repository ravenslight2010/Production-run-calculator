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
import { useState } from "react";
import type { StaffMember } from "./inventoryShared";

const mocks = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  signInRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  setAuthRequestEpoch: vi.fn(),
  resetMasterDataTransportCache: vi.fn(),
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

vi.mock("./masterData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./masterData")>();
  return {
    ...actual,
    resetMasterDataTransportCache: mocks.resetMasterDataTransportCache,
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
  const { me, signIn, consumeFreshSession } = useAuth();
  const [consumed, setConsumed] = useState<string>("not-consumed");
  return (
    <>
      <output data-testid="identity">{me?.userId ?? "signed-out"}</output>
      <output data-testid="fresh-session">{consumed}</output>
      <button type="button" onClick={() => void signIn("manager", "password")}>
        Sign in
      </button>
      <button
        type="button"
        onClick={() => setConsumed(String(consumeFreshSession()))}
      >
        Consume fresh session
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
  mocks.resetMasterDataTransportCache.mockReset();
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
    expect(mocks.resetMasterDataTransportCache).toHaveBeenCalledTimes(1);

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

  it("marks a successful sign-in as fresh exactly once", async () => {
    mocks.fetchMe.mockResolvedValue(null);
    mocks.signInRequest.mockResolvedValue({ token: "ignored", user: manager });

    renderAuth();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("manager-1");

    const consume = screen.getByRole("button", { name: "Consume fresh session" });
    await userEvent.click(consume);
    expect(screen.getByTestId("fresh-session").textContent).toBe("true");
    await userEvent.click(consume);
    expect(screen.getByTestId("fresh-session").textContent).toBe("false");
  });

  it("does not mark a session restored by the cold /me probe as fresh", async () => {
    mocks.fetchMe.mockResolvedValue(manager);

    renderAuth();
    await screen.findByText("manager-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Consume fresh session" }),
    );

    expect(screen.getByTestId("fresh-session").textContent).toBe("false");
  });
});