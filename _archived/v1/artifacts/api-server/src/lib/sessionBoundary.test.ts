// Unit tests for the cached daily-reset boundary read.
//
// getSessionBoundaryMs reads `dayState.resetBoundaryAt` off TODAY's daily_sync
// row, caches it briefly (so requireAuth never pays a DB round-trip per request),
// and must FAIL OPEN on a DB error — a database blip should never log everyone out.
// We mock @workspace/db so we can control the row and force errors deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let rows: Array<{ data: unknown }> = [];
let throwOnQuery = false;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (throwOnQuery) throw new Error("db down");
          return rows;
        },
      }),
    }),
  },
  dailySyncTable: { date: "date" },
}));

// sessionBoundary only uses `eq`; stub it so the fake dailySyncTable column above
// doesn't trip the real implementation, keeping the rest of drizzle intact.
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: () => ({}) };
});

import { getSessionBoundaryMs, clearSessionBoundaryCache } from "./sessionBoundary";

function setReset(resetBoundaryAt: number | undefined): void {
  rows =
    resetBoundaryAt === undefined
      ? [{ data: { dayState: {} } }]
      : [{ data: { dayState: { resetBoundaryAt } } }];
}

beforeEach(() => {
  rows = [];
  throwOnQuery = false;
  clearSessionBoundaryCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSessionBoundaryMs", () => {
  it("returns the resetBoundaryAt recorded on today's row", async () => {
    setReset(1_700_000_000_000);
    expect(await getSessionBoundaryMs()).toBe(1_700_000_000_000);
  });

  it("returns 0 when today has no row at all", async () => {
    rows = [];
    expect(await getSessionBoundaryMs()).toBe(0);
  });

  it("returns 0 when today's row has no resetBoundaryAt yet", async () => {
    setReset(undefined);
    expect(await getSessionBoundaryMs()).toBe(0);
  });

  it("treats a non-positive resetBoundaryAt as no boundary (0)", async () => {
    setReset(0);
    expect(await getSessionBoundaryMs()).toBe(0);
  });

  it("caches the value within the TTL and re-reads after it lapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T08:00:00Z"));

    setReset(1000);
    expect(await getSessionBoundaryMs()).toBe(1000);

    // The underlying row changes, but within the TTL we keep serving the cache.
    setReset(2000);
    vi.advanceTimersByTime(5_000);
    expect(await getSessionBoundaryMs()).toBe(1000);

    // Past the TTL the next read picks up the new value.
    vi.advanceTimersByTime(11_000);
    expect(await getSessionBoundaryMs()).toBe(2000);
  });

  it("fails open to the last known boundary on a DB error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T08:00:00Z"));

    setReset(5000);
    expect(await getSessionBoundaryMs()).toBe(5000); // warm the cache

    // Let the cache lapse so the next call must hit the (now failing) DB.
    vi.advanceTimersByTime(20_000);
    throwOnQuery = true;
    // It must not throw and must not collapse to 0 (which would unfence
    // everyone); it returns the last known boundary instead.
    await expect(getSessionBoundaryMs()).resolves.toBe(5000);
  });

  it("fails open to 0 (no fencing) when there is no last known boundary", async () => {
    throwOnQuery = true; // cache is empty after beforeEach's clear
    await expect(getSessionBoundaryMs()).resolves.toBe(0);
  });
});
