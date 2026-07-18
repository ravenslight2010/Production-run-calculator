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
import { pickCurrentRunPushValue, isEmptyOverPopulated, isAllDefaultRunValue } from "./storage";
import { DEFAULT_VALUES, formSchema, type FormValues } from "./types";

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

// isEmptyOverPopulated is the shared predicate behind BOTH the push guard and the
// new RECEIVE guards (run-values merge loop + form.reset) that stop an incoming
// all-default remote value from wiping good local data on every reconnect/refresh
// — the bidirectional half of the same corruption.
describe("isEmptyOverPopulated", () => {
  it("flags an empty candidate against a populated fallback (the receive data-loss vector)", () => {
    expect(isEmptyOverPopulated({ ...DEFAULT_VALUES }, populated())).toBe(true);
  });
  it("does not flag a populated candidate (a genuine remote edit is accepted)", () => {
    expect(isEmptyOverPopulated(populated(), populated())).toBe(false);
  });
  it("does not flag empty-over-empty (a legitimately blank run, nothing to protect)", () => {
    expect(isEmptyOverPopulated({ ...DEFAULT_VALUES }, { ...DEFAULT_VALUES })).toBe(false);
  });
});

// Legacy blank runs were saved when the four pep batch-lbs fields defaulted to
// 25 (not 0). Those stored copies must still count as "all default" so:
//  • a legacy blank stored copy never blocks a genuine live edit,
//  • a legacy blank remote value never counts as "populated" and clobbers,
//  • the blank-run sweep still recognizes them.
// ONLY the exact legacy signature (all four pep fields at 25, everything else
// default) is blank. A user-typed pep batch weight — including a lone 25 —
// counts as REAL data.
describe("isAllDefaultRunValue (legacy pep-25 blank shape)", () => {
  const legacyBlank = (): FormValues => ({
    ...DEFAULT_VALUES,
    pep1BatchLbs: 25,
    pep2BatchLbs: 25,
    pep1BatchLbsB: 25,
    pep2BatchLbsB: 25,
  });

  it("treats the current all-zero DEFAULT_VALUES as all-default", () => {
    expect(isAllDefaultRunValue({ ...DEFAULT_VALUES })).toBe(true);
  });
  it("treats the exact legacy pep-25 blank shape as all-default", () => {
    expect(isAllDefaultRunValue(legacyBlank())).toBe(true);
  });
  it("treats a lone user-typed 25 as REAL data (only the full 4-field signature is legacy-blank)", () => {
    expect(isAllDefaultRunValue({ ...DEFAULT_VALUES, pep1BatchLbs: 25 })).toBe(false);
  });
  it("treats the legacy 25s alongside any other real data as REAL (never sweepable)", () => {
    expect(isAllDefaultRunValue({ ...legacyBlank(), casesNeeded: 100 })).toBe(false);
  });
  it("treats a user-typed pep batch weight as REAL data", () => {
    expect(isAllDefaultRunValue({ ...DEFAULT_VALUES, pep1BatchLbs: 30 })).toBe(false);
  });
  it("a legacy blank stored copy does not block pushing a fresh blank live form", () => {
    expect(isEmptyOverPopulated({ ...DEFAULT_VALUES }, legacyBlank())).toBe(false);
  });
  it("a legacy blank incoming value never overwrites populated local data", () => {
    expect(isEmptyOverPopulated(legacyBlank(), populated())).toBe(true);
  });
});

// The formSchema fallbacks once invented line numbers (casesNeeded 384,
// cycleSpeed 7.8, pep batch 25 lbs, …) when a legacy stored blob was missing a
// field. They must all be 0 now (speedAdjustment 1.0 is the one meaningful
// numeric default) and must agree with DEFAULT_VALUES exactly.
describe("formSchema legacy fallbacks", () => {
  it("parses an empty blob to all-zero quantity fields (no invented progress/settings)", () => {
    const parsed = formSchema.parse({});
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== "number") continue;
      if (k === "speedAdjustment") { expect(v).toBe(1.0); continue; }
      expect(v, `schema default for ${k}`).toBe(0);
    }
  });
  it("schema defaults agree with DEFAULT_VALUES", () => {
    expect(formSchema.parse({})).toEqual(DEFAULT_VALUES);
  });
  it("accepts 0 pep batch weights (min relaxed from 0.1)", () => {
    expect(() => formSchema.parse({ ...DEFAULT_VALUES, pep1BatchLbs: 0 })).not.toThrow();
  });
});
