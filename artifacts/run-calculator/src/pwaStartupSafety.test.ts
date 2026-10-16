import { describe, expect, it, vi } from "vitest";

import {
  checkPreHomeReloadSafety,
  isPreHomeReloadSafe,
} from "./pwaStartupSafety";

const today = "2026-10-16";

function snapshot(runs: unknown[] = []) {
  return {
    completeness: "complete",
    dayState: { date: today, runs },
  };
}

describe("pre-Home PWA reload safety", () => {
  it("requires complete safe server state and safe current-day local state", () => {
    expect(isPreHomeReloadSafe(snapshot(), null, today)).toBe(true);
    expect(isPreHomeReloadSafe(snapshot(), JSON.stringify({
      date: today,
      runs: [{ id: "pending-run" }],
    }), today)).toBe(true);
    expect(isPreHomeReloadSafe(snapshot(), JSON.stringify({
      date: today,
      runs: [{ id: "active-run", startedAt: 100 }],
    }), today)).toBe(false);
    expect(isPreHomeReloadSafe(snapshot([
      { id: "active-run", startedAt: 100 },
    ]), null, today)).toBe(false);
    expect(isPreHomeReloadSafe(snapshot([
      { id: "nonzero-start", startedAt: -1 },
    ]), null, today)).toBe(false);
  });

  it("fails closed for stale, incomplete, or malformed safety data", () => {
    expect(isPreHomeReloadSafe({
      completeness: "partial",
      dayState: { date: today, runs: [] },
    }, null, today)).toBe(false);
    expect(isPreHomeReloadSafe(snapshot(), "{not-json", today)).toBe(false);
    expect(isPreHomeReloadSafe(snapshot(), JSON.stringify({
      date: today,
      runs: "unknown",
    }), today)).toBe(false);
    expect(isPreHomeReloadSafe({
      completeness: "complete",
      dayState: { date: "2026-10-15", runs: [] },
    }, null, today)).toBe(false);
  });

  it("uses an authenticated no-store snapshot and requires the complete marker", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "X-Sync-Response": "complete" }),
      json: async () => snapshot(),
    }));
    const storage = { getItem: () => null };

    await expect(checkPreHomeReloadSafety({
      fetcher,
      storage,
      today,
    })).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/sync/today?today=${today}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("fails closed on a rejected snapshot request", async () => {
    await expect(checkPreHomeReloadSafety({
      fetcher: vi.fn().mockRejectedValue(new Error("offline")),
      storage: { getItem: () => null },
      today,
    })).resolves.toBe(false);
  });

  it("fails closed when reading the persisted day state throws", async () => {
    const fetcher = vi.fn();
    await expect(checkPreHomeReloadSafety({
      fetcher,
      storage: {
        getItem: () => {
          throw new Error("storage blocked");
        },
      },
      today,
    })).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
