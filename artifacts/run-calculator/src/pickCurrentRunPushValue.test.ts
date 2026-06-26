// @vitest-environment node
//
// Regression guard for the recurring shared day-state data loss ("I entered cases
// needed / setup, refreshed, and it all vanished"). The /api/sync server is a pure
// last-writer-wins blob store, so whatever a client PUTs replaces the row. When
// building the sync payload the CURRENT run's value comes from the live form, but
// its edit timestamp (runValuesUpdatedAt) is read independently from localStorage.
// During mount/hydration and right after any programmatic form.reset() the form is
// transiently all-default while localStorage still holds the real value AND its
// real stamp. A push firing in that window would emit an EMPTY value paired with a
// REAL stamp; because the stamps are equal the per-run lost-update guard on every
// peer ACCEPTS the empty value and the real run data is wiped.
//
// pickCurrentRunPushValue() is the push-boundary guard: never let an all-default
// live form overwrite a populated stored value. This asserts that invariant.

import { describe, it, expect } from "vitest";
import { pickCurrentRunPushValue } from "./storage";
import { DEFAULT_VALUES, type FormValues } from "./types";

const populated = (): FormValues => ({ ...DEFAULT_VALUES, casesNeeded: 240, dieType: "10in" });

describe("pickCurrentRunPushValue", () => {
  it("never pushes an all-default live form over a populated stored value (the data-loss vector)", () => {
    const live = { ...DEFAULT_VALUES };
    const stored = populated();
    // Must fall back to the durable stored value, not the transient empty form.
    expect(pickCurrentRunPushValue(live, stored)).toBe(stored);
  });

  it("pushes a genuine live edit even when the stored value is populated", () => {
    const live = { ...DEFAULT_VALUES, casesNeeded: 999 };
    const stored = populated();
    expect(pickCurrentRunPushValue(live, stored)).toBe(live);
  });

  it("pushes the live form for a legitimately blank run (stored is also default)", () => {
    const live = { ...DEFAULT_VALUES };
    const stored = { ...DEFAULT_VALUES };
    // Both default -> nothing real to protect; push the live form as before.
    expect(pickCurrentRunPushValue(live, stored)).toBe(live);
  });

  it("pushes the live form whenever it differs from default, regardless of stored", () => {
    const live = populated();
    const stored = { ...DEFAULT_VALUES };
    expect(pickCurrentRunPushValue(live, stored)).toBe(live);
  });
});
