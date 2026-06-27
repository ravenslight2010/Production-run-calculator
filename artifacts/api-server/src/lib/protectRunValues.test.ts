// Pure unit test for the server-side per-run protective merge. Kept DB-free on
// purpose (no module that binds @workspace/db at import) so it never trips the
// integration-test DB-binding gotcha.
//
// The merge makes PUT /sync a per-run last-writer-wins register keyed on each
// run's edit stamp instead of blind blob replacement, which is what stops the
// recurring shared day-state data loss: an empty run value paired with a REAL
// (equal or older) stamp can no longer overwrite a populated stored value.

import { describe, it, expect } from "vitest";
import { protectRunValues } from "./protectRunValues";

type Payload = {
  runValues: Record<string, { casesNeeded?: number } | Record<string, never>>;
  runValuesUpdatedAt: Record<string, number>;
  other?: unknown;
};

const EMPTY = {};
const POP = { casesNeeded: 240 };

describe("protectRunValues", () => {
  it("keeps the populated stored value when an empty push arrives with an EQUAL stamp (the corruption)", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: EMPTY }, runValuesUpdatedAt: { r1: 1000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(1000);
  });

  it("keeps the stored value when an empty push arrives with an OLDER stamp", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 2000 } };
    const incoming: Payload = { runValues: { r1: EMPTY }, runValuesUpdatedAt: { r1: 1000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(2000);
  });

  it("accepts a strictly-newer-stamped edit (a genuine update wins)", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: { casesNeeded: 999 } }, runValuesUpdatedAt: { r1: 2000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual({ casesNeeded: 999 });
    expect(out.runValuesUpdatedAt.r1).toBe(2000);
  });

  it("accepts a bumped-stamp HEAL re-push that carries the good value (empty stored -> good wins)", () => {
    // The corrupted row got persisted (empty + real stamp 1000); a healthy client
    // re-pushes the good value with a freshly bumped stamp so it strictly wins.
    const existing: Payload = { runValues: { r1: EMPTY }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1700000000000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(1700000000000);
  });

  it("additively preserves a stored run the incoming push omitted (no transient drop)", () => {
    const existing: Payload = {
      runValues: { r1: POP, r2: { casesNeeded: 50 } },
      runValuesUpdatedAt: { r1: 1000, r2: 1000 },
    };
    const incoming: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r2).toEqual({ casesNeeded: 50 });
    expect(out.runValuesUpdatedAt.r2).toBe(1000);
  });

  it("accepts a brand-new run not present in the stored row", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = {
      runValues: { r1: POP, r2: { casesNeeded: 7 } },
      runValuesUpdatedAt: { r1: 1000, r2: 1500 },
    };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r2).toEqual({ casesNeeded: 7 });
  });

  it("accepts the incoming payload wholesale on the first write (nothing stored yet)", () => {
    const incoming: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    expect(protectRunValues(incoming, null)).toBe(incoming);
    expect(protectRunValues(incoming, undefined)).toBe(incoming);
  });

  it("does not touch non-run payload fields", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 }, other: "stored" };
    const incoming: Payload = { runValues: { r1: EMPTY }, runValuesUpdatedAt: { r1: 1000 }, other: "incoming" };
    const out = protectRunValues(incoming, existing) as Payload;
    // Other fields always come from the incoming payload (client-side additive merge).
    expect(out.other).toBe("incoming");
  });

  it("returns non-object payloads unchanged", () => {
    expect(protectRunValues(null, { runValues: {} })).toBe(null);
    expect(protectRunValues("x", { runValues: {} })).toBe("x");
  });
});
