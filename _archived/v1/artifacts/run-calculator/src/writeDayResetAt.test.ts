import { describe, it, expect } from "vitest";
import { writeDayResetAt } from "./utils";

// writeDayResetAt guards the daily-reset SESSION BOUNDARY (dayState.resetAt).
// Schedule/import writes must never advance it on TODAY's live row (doing so
// force-signs-out every session AND triggers protectRunValues' wholesale-reset
// escape hatch — the "daily reset happened early" bug). Future-day writes keep
// stamping `now` for wholesale-override semantics (harmless: the server boundary
// only reads today's row).
describe("writeDayResetAt", () => {
  const TODAY = "2026-07-02";
  const NOW = 1_700_000_000_000;

  it("stamps `now` when writing to a FUTURE day (override semantics preserved)", () => {
    expect(writeDayResetAt("2026-07-05", TODAY, undefined, undefined, NOW)).toBe(NOW);
    expect(writeDayResetAt("2026-07-05", TODAY, 123, 456, NOW)).toBe(NOW);
  });

  it("NEVER advances the boundary when writing to TODAY", () => {
    // No existing boundary anywhere -> 0 (no fence created), NOT `now`.
    expect(writeDayResetAt(TODAY, TODAY, undefined, undefined, NOW)).toBe(0);
    expect(writeDayResetAt(TODAY, TODAY, undefined, undefined, NOW)).not.toBe(NOW);
  });

  it("preserves the existing server-row boundary for TODAY", () => {
    expect(writeDayResetAt(TODAY, TODAY, 999, 111, NOW)).toBe(999);
  });

  it("falls back to the live day's boundary for TODAY when no server row value", () => {
    expect(writeDayResetAt(TODAY, TODAY, undefined, 111, NOW)).toBe(111);
  });

  it("treats resetAt 0 as a real (preserved) value, not missing", () => {
    // `??` must not coerce 0 -> now; a fresh day legitimately carries resetAt 0.
    expect(writeDayResetAt(TODAY, TODAY, 0, 111, NOW)).toBe(0);
  });
});
