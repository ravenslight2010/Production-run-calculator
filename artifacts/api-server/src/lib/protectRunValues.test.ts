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

// The EXACT all-default ("blank") run value a client emits for a run it has no
// real data for (web loadRunValues returns DEFAULT_VALUES for an unknown id).
// Must mirror BLANK_RUN_VALUE in protectRunValues.ts / DEFAULT_VALUES on the
// clients. The server's empty-over-populated guard recognizes blank by EXACT
// deep-equality, so these tests use the full shape rather than `{}`.
const BLANK = {
  casesNeeded: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  approxLineSpeed: 0,
  freezerTime: 0,
  pizzasPerCase: 0,
  casesPerSkid: 0,
  casesPerLayer: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  doughBatchYield: 0,
  crustsPerCase: 0,
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  carryOverDone: false,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Sticks: 0,
  pep1OzPerPizza: 0,
  pep1BatchLbs: 25,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 25,
  app1Type: "",
  app2Type: "",
  app3Type: "",
  app4Type: "",
  pep1Type: "",
  pep2Type: "",
  dieType: "",
  allergen: "none",
  doughRecipeName: "",
  targetDoughballWeight: 0,
  doughRecipe: [],
  app1CheeseRecipeName: "",
  app1CheeseRecipe: [],
  app2CheeseRecipeName: "",
  app2CheeseRecipe: [],
  app3CheeseRecipeName: "",
  app3CheeseRecipe: [],
  app4CheeseRecipeName: "",
  app4CheeseRecipe: [],
  frontlineRecipeName: "",
  frontlineRecipe: [],
  cartoned: "yes",
  cartonsPerCase: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
};

describe("protectRunValues", () => {
  it("keeps the populated stored value when an empty push arrives with an EQUAL stamp (the corruption)", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: EMPTY }, runValuesUpdatedAt: { r1: 1000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(1000);
  });

  it("keeps the populated stored value when an all-default push arrives with a STRICTLY-NEWER stamp over an UNSTAMPED stored value (the production hole)", () => {
    // Imports / daily-rollover adopt populated run values WITHOUT a stamp, so the
    // stored stamp is 0. A stale-but-positive client stamp paired with an
    // all-default value used to win here and wipe the real data. It must not.
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 0 } };
    const incoming: Payload = { runValues: { r1: BLANK }, runValuesUpdatedAt: { r1: 1700000000000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    // Stamp is advanced past the corrupt push so the surviving value strictly
    // wins on every peer (and heals the offending client on its next read).
    expect(out.runValuesUpdatedAt.r1).toBe(1700000000000);
  });

  it("keeps the populated stored value when an all-default push arrives with a strictly-newer stamp over a LOWER positive stamp", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: BLANK }, runValuesUpdatedAt: { r1: 2000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(2000);
  });

  it("still accepts an all-default value for a BRAND-NEW run (nothing populated to protect)", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = {
      runValues: { r1: POP, r2: BLANK },
      runValuesUpdatedAt: { r1: 1000, r2: 1500 },
    };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r2).toEqual(BLANK);
    expect(out.runValuesUpdatedAt.r2).toBe(1500);
  });

  it("still accepts a strictly-newer POPULATED edit over an unstamped stored value (real edits win)", () => {
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 0 } };
    const incoming: Payload = { runValues: { r1: { casesNeeded: 480 } }, runValuesUpdatedAt: { r1: 1700000000000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual({ casesNeeded: 480 });
    expect(out.runValuesUpdatedAt.r1).toBe(1700000000000);
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

describe("protectRunValues run-list lifecycle LWW (metaUpdatedAt)", () => {
  type RunMeta = {
    id: string;
    startedAt?: number;
    endedAt?: number;
    metaUpdatedAt?: number;
  };
  type DayPayload = {
    dayState: { runs: RunMeta[]; resetAt?: number };
    runValues: Record<string, unknown>;
    runValuesUpdatedAt: Record<string, number>;
    deletedItems?: Record<string, string[]>;
  };
  const mk = (runs: RunMeta[], extra?: Partial<DayPayload>): DayPayload => ({
    dayState: { runs, resetAt: 500 },
    runValues: {},
    runValuesUpdatedAt: {},
    ...extra,
  });
  const outRuns = (out: unknown): RunMeta[] =>
    (out as DayPayload).dayState.runs;

  it("keeps the STORED run copy when its metaUpdatedAt is strictly newer (a stale peer can't un-start a run)", () => {
    // Stored row has the just-started run (stamped 2000); a stale peer pushes
    // the same run still unstarted with an older stamp. The started copy wins.
    const existing = mk([{ id: "r1", startedAt: 111, metaUpdatedAt: 2000 }]);
    const incoming = mk([{ id: "r1", metaUpdatedAt: 1000 }]);
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out).toEqual([{ id: "r1", startedAt: 111, metaUpdatedAt: 2000 }]);
  });

  it("accepts the INCOMING run copy when its metaUpdatedAt is strictly newer", () => {
    const existing = mk([{ id: "r1", metaUpdatedAt: 1000 }]);
    const incoming = mk([{ id: "r1", startedAt: 222, metaUpdatedAt: 2000 }]);
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out).toEqual([{ id: "r1", startedAt: 222, metaUpdatedAt: 2000 }]);
  });

  it("keeps incoming on EQUAL stamps (tie -> incoming, the pre-stamp status quo)", () => {
    const existing = mk([{ id: "r1", startedAt: 111, metaUpdatedAt: 1000 }]);
    const incoming = mk([{ id: "r1", endedAt: 333, metaUpdatedAt: 1000 }]);
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out).toEqual([{ id: "r1", endedAt: 333, metaUpdatedAt: 1000 }]);
  });

  it("keeps incoming when NEITHER side carries a stamp (legacy payloads unchanged)", () => {
    const existing = mk([{ id: "r1", startedAt: 111 }]);
    const incoming = mk([{ id: "r1" }]);
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out).toEqual([{ id: "r1" }]);
  });

  it("keeps a stamped STORED copy over an UNSTAMPED incoming one", () => {
    const existing = mk([{ id: "r1", startedAt: 111, metaUpdatedAt: 2000 }]);
    const incoming = mk([{ id: "r1" }]);
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out).toEqual([{ id: "r1", startedAt: 111, metaUpdatedAt: 2000 }]);
  });

  it("preserves incoming-first ordering and appends stored-only runs", () => {
    const existing = mk([
      { id: "r1", metaUpdatedAt: 1000 },
      { id: "r3", metaUpdatedAt: 1000 },
    ]);
    const incoming = mk([
      { id: "r2", metaUpdatedAt: 1000 },
      { id: "r1", startedAt: 9, metaUpdatedAt: 3000 },
    ]);
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    expect(out[1]).toEqual({ id: "r1", startedAt: 9, metaUpdatedAt: 3000 });
  });

  it("still filters tombstoned runs even when the stored copy is newer-stamped", () => {
    const existing = mk([{ id: "r1", startedAt: 111, metaUpdatedAt: 9999 }]);
    const incoming = mk([{ id: "r2", metaUpdatedAt: 1 }], {
      deletedItems: { runs: ["r1"] },
    });
    const out = outRuns(protectRunValues(incoming, existing));
    expect(out.map((r) => r.id)).toEqual(["r2"]);
  });
});
