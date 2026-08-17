/**
 * Sync-receive rounding guard for casesOnCurrentSkid.
 *
 * The three write paths in home.tsx that compute casesOnCurrentSkid via modulo
 * are wrapped in Math.round(), but a float value written before that fix (or by
 * any edge-case path) could already be stored in day-state. When it arrives via
 * SSE sync the receive handler must round it before saving, or it renders with
 * decimals in the skid counter display.
 *
 * This test validates the rounding formula applied in the sync-receive block
 * (home.tsx applySyncCallbackRef, "acceptedVals" construction).
 */

import { describe, it, expect } from "vitest";

// ── Inline replica of the rounding formula from the sync-receive handler ─────
// Mirrors the logic at the "acceptedVals" construction in home.tsx.
function roundCasesOnCurrentSkid(raw: unknown): number {
  return Math.round(Number(raw) || 0);
}

describe("sync-receive casesOnCurrentSkid rounding", () => {
  it("rounds a positive float down", () => {
    expect(roundCasesOnCurrentSkid(31.444)).toBe(31);
  });

  it("rounds a float up when >= .5", () => {
    expect(roundCasesOnCurrentSkid(31.5)).toBe(32);
  });

  it("passes an already-integer value through unchanged", () => {
    expect(roundCasesOnCurrentSkid(12)).toBe(12);
  });

  it("rounds zero", () => {
    expect(roundCasesOnCurrentSkid(0)).toBe(0);
  });

  it("rounds a very small positive float to 0", () => {
    expect(roundCasesOnCurrentSkid(0.2)).toBe(0);
  });

  it("handles undefined (missing field) as 0", () => {
    expect(roundCasesOnCurrentSkid(undefined)).toBe(0);
  });

  it("handles null as 0", () => {
    expect(roundCasesOnCurrentSkid(null)).toBe(0);
  });

  it("handles a string float (coerced)", () => {
    expect(roundCasesOnCurrentSkid("14.7")).toBe(15);
  });

  it("handles NaN as 0", () => {
    expect(roundCasesOnCurrentSkid(NaN)).toBe(0);
  });

  it("preserves large integer values", () => {
    expect(roundCasesOnCurrentSkid(999)).toBe(999);
  });
});
