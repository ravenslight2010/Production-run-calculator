// The shared API wrapper has two deliberately different error paths:
// - 401 ends the signed-in browser session (including the midnight boundary).
// - 403 is an authorization result for the current session and must NOT log the
//   user out. Components can keep their contextual permission message visible.

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithDiagnostics: vi.fn(),
}));

vi.mock("./performanceDiagnostics", () => ({
  fetchWithDiagnostics: mocks.fetchWithDiagnostics,
  recordBrowserLoadTimings: vi.fn(),
}));

import {
  fetchInventory,
  InventoryApiError,
  setUnauthorizedHandler,
} from "./inventoryShared";

function failure(status: number, error: string, reason?: string): Response {
  return new Response(JSON.stringify({ error, ...(reason ? { reason } : {}) }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  mocks.fetchWithDiagnostics.mockReset();
  setUnauthorizedHandler(null);
});

describe("shared API authorization errors", () => {
  it("reports a 401 to the session handler and retains its server message", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mocks.fetchWithDiagnostics.mockResolvedValue(failure(401, "Unauthorized"));

    await expect(fetchInventory()).rejects.toMatchObject<Partial<InventoryApiError>>({
      status: 401,
      serverMessage: "Unauthorized",
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("returns a 403 to the caller without ending the session", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mocks.fetchWithDiagnostics.mockResolvedValue(
      failure(403, "Missing capability: manage-inventory"),
    );

    await expect(fetchInventory()).rejects.toMatchObject<Partial<InventoryApiError>>({
      status: 403,
      serverMessage: "Missing capability: manage-inventory",
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("accepts only the safe daily-reset session reason", async () => {
    setUnauthorizedHandler(vi.fn());
    mocks.fetchWithDiagnostics.mockResolvedValue(
      failure(401, "Unauthorized", "daily_reset"),
    );

    await expect(fetchInventory()).rejects.toMatchObject({
      status: 401,
      authSessionReason: "daily_reset",
    });
  });

  it("does not expose arbitrary server reason strings", async () => {
    setUnauthorizedHandler(vi.fn());
    mocks.fetchWithDiagnostics.mockResolvedValue(
      failure(401, "Unauthorized", "user:manager@example.com"),
    );

    await expect(fetchInventory()).rejects.toMatchObject({
      status: 401,
      authSessionReason: null,
    });
  });
});