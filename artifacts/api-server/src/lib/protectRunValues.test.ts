// Pure unit test for the server-side per-run protective merge. Kept DB-free on
// purpose (no module that binds @workspace/db at import) so it never trips the
// integration-test DB-binding gotcha.
//
// The merge makes PUT /sync a per-run last-writer-wins register keyed on each
// run's edit stamp instead of blind blob replacement, which is what stops the
// recurring shared day-state data loss: an empty run value paired with a REAL
// (equal or older) stamp can no longer overwrite a populated stored value.

import { describe, it, expect } from "vitest";
import { protectRunValues, sanitizeSyncPayload, isSyncPayloadTooLarge, capMergedResult } from "./protectRunValues";

type Payload = {
  runValues: Record<string, Record<string, unknown>>;
  runValuesUpdatedAt: Record<string, number>;
  dayState?: { runs: Array<{ id: string }>; resetAt?: number };
  other?: unknown;
};

const EMPTY = {};
const POP = { casesNeeded: 240 };

// The EXACT all-default ("blank") run values a client emits for a run it has no
// real data for (web loadRunValues returns DEFAULT_VALUES for an unknown id).
// Must mirror LEGACY_BLANK_RUN_VALUE / CURRENT_BLANK_RUN_VALUE in
// protectRunValues.ts / DEFAULT_VALUES on the clients. The server's
// empty-over-populated guard recognizes blank by EXACT deep-equality, so these
// tests use the full shapes rather than `{}`.

// Older client field set, pep batch defaults 25.
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

// Today's DEFAULT_VALUES shape — all-zero quantities (speedAdjustment 1.0),
// including the pep "B"-slot, timer, and label fields added since.
const CURRENT_BLANK = {
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
  mixerLowSec: 0,
  mixerHighSec: 0,
  hopperSec: 0,
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
  pep1BatchLbs: 0,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 0,
  pep1Combined: true,
  pep1TypeB: "",
  pep2TypeB: "",
  pep1SticksB: 0,
  pep1OzPerPizzaB: 0,
  pep1BatchLbsB: 0,
  pep2SticksB: 0,
  pep2OzPerPizzaB: 0,
  pep2BatchLbsB: 0,
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
  cartoned: "cartoned",
  labelPosition: "",
  cartonsPerCase: 0,
  labelsPerRoll: 0,
  topLabelsPerRoll: 0,
  bottomLabelsPerRoll: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
  // 0 → normalized to 2.5 by MACHINE_TIME_DEFAULTS (preTunnelMin/postTunnelMin
  // default moved from 0 to 2.5; old clients may carry 0).
  preTunnelMin: 0,
  postTunnelMin: 0,
  tempFreezerTime: 0,
  tempCrustsPerCycle: 0,
  tempCycleSpeed: 0,
};

describe("protectRunValues", () => {
  it("retains cold history when a hot live payload omits it", () => {
    const existing = {
      runValues: { r1: POP },
      runValuesUpdatedAt: { r1: 1000 },
      history: [{ date: "2030-01-01", runs: [], runValues: {} }],
    };
    const incoming = {
      runValues: { r1: { casesNeeded: 241 } },
      runValuesUpdatedAt: { r1: 2000 },
    };
    const out = protectRunValues(incoming, existing) as typeof existing;
    expect(out.history).toEqual(existing.history);
    expect(out.runValues.r1).toEqual({ casesNeeded: 241 });
  });

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

  it("recognizes the CURRENT all-zero blank shape as empty-over-populated", () => {
    // Web defaults changed: pep batch lbs now default to 0, and newer fields
    // (B slots, mixer timers, labels) exist. A blank push in this shape must
    // not overwrite real data even with a strictly-newer stamp.
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 0 } };
    const incoming: Payload = { runValues: { r1: CURRENT_BLANK }, runValuesUpdatedAt: { r1: 1700000000000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(1700000000000);
  });

  it("recognizes the current shape carrying the exact legacy pep-25 signature (all four fields) as blank", () => {
    const legacySig = { ...CURRENT_BLANK, pep1BatchLbs: 25, pep2BatchLbs: 25, pep1BatchLbsB: 25, pep2BatchLbsB: 25 };
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: legacySig }, runValuesUpdatedAt: { r1: 2000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual(POP);
    expect(out.runValuesUpdatedAt.r1).toBe(2000);
  });

  it("treats a LONE pep 25 (not all four) as real data — a newer-stamped push wins, but casesNeeded is preserved", () => {
    // lone25 carries pep1BatchLbs=25 (a real edit, not the legacy-blank four-at-25
    // signature) but has casesNeeded=0 because this peer never received the schedule.
    // The incoming edit is genuine and wins the LWW merge, BUT the casesNeeded field
    // must be patched back from the stored value so the planned target is never silently
    // zeroed by a peer who doesn't have the schedule.
    const lone25 = { ...CURRENT_BLANK, pep1BatchLbs: 25 };
    const existing: Payload = { runValues: { r1: POP }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: lone25 }, runValuesUpdatedAt: { r1: 2000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect(out.runValues.r1).toEqual({ ...lone25, casesNeeded: 240 });
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

  it("preserves stored casesNeeded when a peer's newer edit carries casesNeeded=0", () => {
    // A peer without the schedule has casesNeeded=0 but enters real line settings,
    // so the run is not all-blank. Their newer stamp wins the LWW check, but
    // casesNeeded must be patched back from the stored value so the planned
    // production target is never silently zeroed.
    const peerWithLineSettings = { ...CURRENT_BLANK, crustsPerCycle: 14, cycleSpeed: 4 };
    const existing: Payload = { runValues: { r1: { casesNeeded: 240, crustsPerCycle: 14, cycleSpeed: 4 } }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: peerWithLineSettings }, runValuesUpdatedAt: { r1: 2000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect((out.runValues.r1 as Record<string, unknown>).casesNeeded).toBe(240);
    expect((out.runValues.r1 as Record<string, unknown>).crustsPerCycle).toBe(14);
    expect(out.runValuesUpdatedAt.r1).toBe(2000);
  });

  it("allows casesNeeded=0 from a peer when stored also has casesNeeded=0 (no schedule on either side)", () => {
    const noSchedule = { ...CURRENT_BLANK, crustsPerCycle: 14 };
    const existing: Payload = { runValues: { r1: { ...CURRENT_BLANK, crustsPerCycle: 12 } }, runValuesUpdatedAt: { r1: 1000 } };
    const incoming: Payload = { runValues: { r1: noSchedule }, runValuesUpdatedAt: { r1: 2000 } };
    const out = protectRunValues(incoming, existing) as Payload;
    expect((out.runValues.r1 as Record<string, unknown>).casesNeeded).toBe(0);
    expect((out.runValues.r1 as Record<string, unknown>).crustsPerCycle).toBe(14);
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

  it("keeps same-day runs when a stale client carries a newer reset marker", () => {
    const existing = {
      dayState: {
        runs: [{ id: "a" }, { id: "b" }, { id: "c" }],
        resetAt: 1000,
      },
      runValues: { a: { casesNeeded: 10 }, b: { casesNeeded: 20 }, c: { casesNeeded: 30 } },
      runValuesUpdatedAt: { a: 1, b: 1, c: 1 },
    };
    const incoming = {
      dayState: { runs: [{ id: "a" }], resetAt: 2000 },
      runValues: { a: { casesNeeded: 10 } },
      runValuesUpdatedAt: { a: 1 },
    };
    const out = protectRunValues(incoming, existing) as Payload;
    expect((out.dayState?.runs ?? []).map((run: any) => run.id).sort()).toEqual(["a", "b", "c"]);
    expect(out.runValues.b).toEqual({ casesNeeded: 20 });
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

  it("keeps an authoritative stored Stop when a waking peer republishes an older running copy", () => {
    const existing = mk([{
      id: "r1",
      startedAt: 111,
      endedAt: 333,
      metaUpdatedAt: 3000,
    }]);
    const staleWakePush = mk([{
      id: "r1",
      startedAt: 111,
      metaUpdatedAt: 2000,
    }]);
    const out = outRuns(protectRunValues(staleWakePush, existing));
    expect(out).toEqual([{
      id: "r1",
      startedAt: 111,
      endedAt: 333,
      metaUpdatedAt: 3000,
    }]);
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

describe("protectRunValues additive list union (brands / name registries)", () => {
  const base = { dayState: { runs: [], resetAt: 0 }, runValues: {}, runValuesUpdatedAt: {} };

  it("preserves existing brands when a fresh device pushes empty brands", () => {
    const existing = { ...base, brands: ["Lucia's Craft", "Corner Booth", "FSD"] };
    const incoming = { ...base, brands: [] }; // fresh device — no localStorage
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.brands).toEqual(
      expect.arrayContaining(["Lucia's Craft", "Corner Booth", "FSD"]),
    );
    expect((out.brands as string[]).length).toBe(3);
  });

  it("unions partial incoming brands with existing brands", () => {
    const existing = { ...base, brands: ["Brand A", "Brand B", "Brand C"] };
    const incoming = { ...base, brands: ["Brand B", "Brand D"] };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.brands).toEqual(
      expect.arrayContaining(["Brand A", "Brand B", "Brand C", "Brand D"]),
    );
    expect((out.brands as string[]).length).toBe(4);
  });

  it("uses incoming-only when existing is empty (first write for a new day)", () => {
    const existing = { ...base, brands: [] };
    const incoming = { ...base, brands: ["Brand X", "Brand Y"] };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.brands).toEqual(expect.arrayContaining(["Brand X", "Brand Y"]));
  });

  it("deduplicates brands in the union", () => {
    const existing = { ...base, brands: ["Alpha", "Beta"] };
    const incoming = { ...base, brands: ["Beta", "Gamma"] };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect((out.brands as string[]).length).toBe(3);
    expect(out.brands).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma"]));
  });

  it("unions cheeseRecipeNames, mixRecipeNames, doughRecipeNames, frontlineRecipeNames the same way", () => {
    const existing = {
      ...base,
      cheeseRecipeNames: ["Mozz Blend", "4 Cheese"],
      mixRecipeNames: ["Veggie Mix", "Pepper Mix"],
      doughRecipeNames: ["NY Style"],
      frontlineRecipeNames: ["House Sauce"],
    };
    const incoming = { ...base }; // fresh device: no list fields at all
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.cheeseRecipeNames).toEqual(expect.arrayContaining(["Mozz Blend", "4 Cheese"]));
    expect(out.mixRecipeNames).toEqual(expect.arrayContaining(["Veggie Mix", "Pepper Mix"]));
    expect(out.doughRecipeNames).toEqual(expect.arrayContaining(["NY Style"]));
    expect(out.frontlineRecipeNames).toEqual(expect.arrayContaining(["House Sauce"]));
  });

  it("preserves existing brandFlavors when fresh device pushes empty object", () => {
    const existing = {
      ...base,
      brandFlavors: { "Lucia's Craft": ["Pepperoni", "Supreme"], "FSD": ["Cheese"] },
    };
    const incoming = { ...base, brandFlavors: {} };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const bf = out.brandFlavors as Record<string, string[]>;
    expect(bf["Lucia's Craft"]).toEqual(expect.arrayContaining(["Pepperoni", "Supreme"]));
    expect(bf["FSD"]).toEqual(expect.arrayContaining(["Cheese"]));
  });

  it("unions brandFlavors per-brand when both sides have flavors", () => {
    const existing = {
      ...base,
      brandFlavors: { "Brand A": ["Flavor 1", "Flavor 2"], "Brand B": ["Flavor 3"] },
    };
    const incoming = {
      ...base,
      brandFlavors: { "Brand A": ["Flavor 2", "Flavor 4"], "Brand C": ["Flavor 5"] },
    };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const bf = out.brandFlavors as Record<string, string[]>;
    expect(bf["Brand A"]).toEqual(expect.arrayContaining(["Flavor 1", "Flavor 2", "Flavor 4"]));
    expect(bf["Brand A"].length).toBe(3);
    expect(bf["Brand B"]).toEqual(expect.arrayContaining(["Flavor 3"]));
    expect(bf["Brand C"]).toEqual(expect.arrayContaining(["Flavor 5"]));
  });

  it("allows a future scheduled-day replacement to bypass list union", () => {
    // Only the route for a FUTURE scheduled row passes this explicit option.
    const existing = {
      ...base,
      dayState: { runs: [], resetAt: 100 },
      brands: ["Old Brand"],
      brandFlavors: { "Old Brand": ["Flavor X"] },
    };
    const incoming = {
      ...base,
      dayState: { runs: [], resetAt: 200 }, // strictly newer → replacement
      brands: [],
      brandFlavors: {},
    };
    const out = protectRunValues(incoming, existing, { allowRunListReplacement: true }) as Record<string, unknown>;
    // Scheduled replacement: incoming wins; brands may be empty (intentional).
    expect((out.brands as string[]).length).toBe(0);
  });
});

describe("protectRunValues delete/un-delete stamp preservation", () => {
  const base = { dayState: { runs: [], resetAt: 0 }, runValues: {}, runValuesUpdatedAt: {} };
  const ns = "flavor:lucia's craft";

  it("keeps stored stamp maps when a stale push omits them entirely", () => {
    const existing = { ...base, undeletedStamps: { [ns]: { "house special": 500 } }, deletedStamps: { [ns]: { cheese: 400 } } };
    const incoming = { ...base }; // old bundle: no stamp fields at all
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.undeletedStamps).toEqual({ [ns]: { "house special": 500 } });
    expect(out.deletedStamps).toEqual({ [ns]: { cheese: 400 } });
  });

  it("merges per-name by MAX across incoming and stored", () => {
    const existing = { ...base, undeletedStamps: { [ns]: { "house special": 500, supreme: 900 } } };
    const incoming = { ...base, undeletedStamps: { [ns]: { "house special": 800, "3 meat": 300 } } };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.undeletedStamps).toEqual({ [ns]: { "house special": 800, supreme: 900, "3 meat": 300 } });
  });

  it("carries stamp maps across a scheduled-day replacement", () => {
    const existing = { ...base, dayState: { runs: [], resetAt: 100 }, undeletedStamps: { [ns]: { "house special": 500 } } };
    const incoming = { ...base, dayState: { runs: [], resetAt: 200 } }; // strictly-newer reset
    const out = protectRunValues(incoming, existing, { allowRunListReplacement: true }) as Record<string, unknown>;
    expect(out.undeletedStamps).toEqual({ [ns]: { "house special": 500 } });
  });

  it("ignores junk stamp values and omits empty maps", () => {
    const incoming = { ...base, deletedStamps: { [ns]: { bad: "x", zero: 0 } } };
    const out = protectRunValues(incoming, { ...base }) as Record<string, unknown>;
    expect(out.deletedStamps).toBeUndefined();
    expect(out.undeletedStamps).toBeUndefined();
  });
});

describe("protectRunValues prepPhase — shift prep phase merge", () => {
  // prepPhase lives inside dayState. The server runs a symmetric merge on same-day
  // pushes (inReset === exReset), applying: earliest non-null start, MAX counts,
  // sticky prepCarriedOver. The wholesale-reset path (inReset > exReset) returns
  // early before reaching this logic, so incoming prepPhase passes through as-is.
  const b = { runValues: {}, runValuesUpdatedAt: {} };
  const ds = (pp?: Record<string, unknown>) => ({
    runs: [] as unknown[],
    resetAt: 100,
    ...(pp ? { prepPhase: pp } : {}),
  });
  const pp = (
    prepStartedAt: number | null,
    prepBatchesDough = 0,
    prepBatchesSauce = 0,
    prepCarriedOver = false,
  ) => ({ prepStartedAt, prepBatchesDough, prepBatchesSauce, prepCarriedOver });

  it("merges to earliest non-null prepStartedAt when both sides have started", () => {
    const incoming = { ...b, dayState: ds(pp(3000, 2, 0)) };
    const existing = { ...b, dayState: ds(pp(1000, 1, 1)) };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const phase = ((out.dayState as Record<string, unknown>).prepPhase as Record<string, unknown>);
    expect(phase.prepStartedAt).toBe(1000); // earlier wins
    expect(phase.prepBatchesDough).toBe(2); // max
    expect(phase.prepBatchesSauce).toBe(1); // max
  });

  it("keeps existing prepStartedAt when incoming has null", () => {
    const incoming = { ...b, dayState: ds(pp(null, 0, 0)) };
    const existing = { ...b, dayState: ds(pp(5000, 3, 1)) };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const phase = ((out.dayState as Record<string, unknown>).prepPhase as Record<string, unknown>);
    expect(phase.prepStartedAt).toBe(5000);
    expect(phase.prepBatchesDough).toBe(3);
  });

  it("keeps incoming prepStartedAt when existing has null", () => {
    const incoming = { ...b, dayState: ds(pp(8000, 2, 0)) };
    const existing = { ...b, dayState: ds(pp(null, 0, 0)) };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const phase = ((out.dayState as Record<string, unknown>).prepPhase as Record<string, unknown>);
    expect(phase.prepStartedAt).toBe(8000);
  });

  it("prepCarriedOver is sticky: incoming true + stored false → true", () => {
    const incoming = { ...b, dayState: ds(pp(1000, 3, 1, true)) };
    const existing = { ...b, dayState: ds(pp(1000, 2, 0, false)) };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const phase = ((out.dayState as Record<string, unknown>).prepPhase as Record<string, unknown>);
    expect(phase.prepCarriedOver).toBe(true);
  });

  it("omits prepPhase from outDay when neither side has it", () => {
    const incoming = { ...b, dayState: ds() };
    const existing = { ...b, dayState: ds() };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    const outDay = out.dayState as Record<string, unknown>;
    expect(outDay.prepPhase).toBeUndefined();
  });
});

// ── sanitizeSyncPayload ────────────────────────────────────────────────────────

describe("sanitizeSyncPayload", () => {
  it("passes through non-object payloads unchanged", () => {
    expect(sanitizeSyncPayload(null)).toBe(null);
    expect(sanitizeSyncPayload("oops")).toBe("oops");
    expect(sanitizeSyncPayload(42)).toBe(42);
  });

  it("strips unknown top-level keys", () => {
    const payload = {
      brands: ["A"],
      __proto__: "bad",
      injectedKey: "malicious",
      constructor: "evil",
      dayState: { runs: [] },
    };
    const out = sanitizeSyncPayload(payload) as Record<string, unknown>;
    expect(out).not.toHaveProperty("injectedKey");
    expect(out).not.toHaveProperty("__proto__");
    expect(out).not.toHaveProperty("constructor");
    expect(out).toHaveProperty("brands");
    expect(out).toHaveProperty("dayState");
  });

  it("keeps all known top-level keys", () => {
    const payload = {
      brands: ["X"],
      pepTypes: ["Pepperoni"],
      dayState: { runs: [] },
      runValues: {},
      runValuesUpdatedAt: {},
      deletedItems: {},
      deletedStamps: {},
      undeletedStamps: {},
      doughRecipeNames: [],
      frontlineRecipeNames: [],
      cheeseRecipeNames: [],
      mixRecipeNames: [],
      brandFlavors: { X: ["Y"] },
    };
    const out = sanitizeSyncPayload(payload) as Record<string, unknown>;
    expect(out).toHaveProperty("brands");
    expect(out).toHaveProperty("pepTypes");
    expect(out).toHaveProperty("dayState");
    expect(out).toHaveProperty("runValues");
    expect(out).toHaveProperty("deletedItems");
    expect(out).toHaveProperty("brandFlavors");
  });

  it("caps string array entries at MAX_LIST_ENTRIES (500)", () => {
    const big = Array.from({ length: 600 }, (_, i) => `brand-${i}`);
    const out = sanitizeSyncPayload({ brands: big }) as Record<string, unknown>;
    expect((out.brands as string[]).length).toBe(500);
  });

  it("truncates individual string entries to 200 chars", () => {
    const longName = "x".repeat(300);
    const out = sanitizeSyncPayload({ pepTypes: [longName] }) as Record<string, unknown>;
    expect((out.pepTypes as string[])[0].length).toBe(200);
  });

  it("filters non-string values out of string-array fields", () => {
    const out = sanitizeSyncPayload({
      brands: ["Good", 42, null, { evil: true }, "Also Good"],
    }) as Record<string, unknown>;
    expect(out.brands).toEqual(["Good", "Also Good"]);
  });

  it("caps brandFlavors brand count and per-brand flavor arrays", () => {
    const bigBrands: Record<string, string[]> = {};
    for (let i = 0; i < 600; i++) bigBrands[`brand-${i}`] = ["flavor"];
    const out = sanitizeSyncPayload({ brandFlavors: bigBrands }) as Record<string, unknown>;
    const bf = out.brandFlavors as Record<string, string[]>;
    expect(Object.keys(bf).length).toBe(500);
  });

  it("caps brandFlavors brand key length to 200 chars", () => {
    const longBrand = "b".repeat(300);
    const out = sanitizeSyncPayload({ brandFlavors: { [longBrand]: ["Flavor"] } }) as Record<string, unknown>;
    const bf = out.brandFlavors as Record<string, string[]>;
    const keys = Object.keys(bf);
    expect(keys[0].length).toBe(200);
  });

  it("strips unknown dayState sub-keys", () => {
    const out = sanitizeSyncPayload({
      dayState: {
        runs: [],
        shiftNotes: "hi",
        resetAt: 0,
        injectedField: "<script>alert(1)</script>",
        __proto__: "bad",
      },
    }) as Record<string, unknown>;
    const ds = out.dayState as Record<string, unknown>;
    expect(ds).not.toHaveProperty("injectedField");
    expect(ds).not.toHaveProperty("__proto__");
    expect(ds).toHaveProperty("runs");
    expect(ds).toHaveProperty("shiftNotes");
    expect(ds).toHaveProperty("resetAt");
  });

  it("caps dayState.shiftNotes at 2000 chars", () => {
    const longNotes = "n".repeat(3000);
    const out = sanitizeSyncPayload({
      dayState: { runs: [], shiftNotes: longNotes },
    }) as Record<string, unknown>;
    const ds = out.dayState as Record<string, unknown>;
    expect((ds.shiftNotes as string).length).toBe(2000);
  });

  it("drops non-string shiftNotes without error", () => {
    const out = sanitizeSyncPayload({
      dayState: { runs: [], shiftNotes: 12345 },
    }) as Record<string, unknown>;
    const ds = out.dayState as Record<string, unknown>;
    expect(ds.shiftNotes).toBeUndefined();
  });

  it("passes through known dayState sub-keys (runs, resetAt, substitutions, etc.)", () => {
    const out = sanitizeSyncPayload({
      dayState: {
        runs: [{ id: "r1" }],
        resetAt: 12345,
        substitutions: { r1: [] },
        substitutionLog: [],
        stagedItems: {},
        prepPhase: { prepStartedAt: 1 },
        date: "2026-01-01",
        runToTime: 3600,
      },
    }) as Record<string, unknown>;
    const ds = out.dayState as Record<string, unknown>;
    expect(ds.runs).toEqual([{ id: "r1" }]);
    expect(ds.resetAt).toBe(12345);
    expect(ds.substitutions).toBeDefined();
    expect(ds.substitutionLog).toBeDefined();
    expect(ds.stagedItems).toBeDefined();
    expect(ds.prepPhase).toBeDefined();
    expect(ds.date).toBe("2026-01-01");
    expect(ds.runToTime).toBe(3600);
  });

  it("does not modify unknown-key-free payloads", () => {
    const payload = {
      brands: ["A", "B"],
      pepTypes: ["Pepperoni"],
      dayState: { runs: [], shiftNotes: "ok", resetAt: 0 },
    };
    const out = sanitizeSyncPayload(payload) as Record<string, unknown>;
    expect((out.brands as string[])).toEqual(["A", "B"]);
    expect((out.pepTypes as string[])).toEqual(["Pepperoni"]);
  });

  it("caps dayState.runs at MAX_RUNS (50)", () => {
    const runs = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, brand: "X", flavor: "Y" }));
    const out = sanitizeSyncPayload({ dayState: { runs, resetAt: 0 } }) as Record<string, unknown>;
    const ds = out.dayState as Record<string, unknown>;
    expect((ds.runs as unknown[]).length).toBe(50);
  });

  it("caps runValues at MAX_RUNS (50) keys", () => {
    const runValues: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) runValues[`r${i}`] = { casesNeeded: i };
    const out = sanitizeSyncPayload({ runValues }) as Record<string, unknown>;
    expect(Object.keys(out.runValues as object).length).toBe(50);
  });

  it("caps runValuesUpdatedAt at MAX_RUNS (50) keys", () => {
    const runValuesUpdatedAt: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) runValuesUpdatedAt[`r${i}`] = Date.now();
    const out = sanitizeSyncPayload({ runValuesUpdatedAt }) as Record<string, unknown>;
    expect(Object.keys(out.runValuesUpdatedAt as object).length).toBe(50);
  });

  it("returns null for a payload that exceeds the 512 KB aggregate size limit", () => {
    // Build a known-key payload that is legitimately structured but very large.
    const bigHistory = Array.from({ length: 5000 }, (_, i) => ({ id: `e${i}`, data: "x".repeat(100) }));
    const result = sanitizeSyncPayload({ history: bigHistory, dayState: { runs: [], resetAt: 0 } });
    expect(result).toBeNull();
  });

  it("returns null for a payload that would exceed 512 KB via multi-byte Unicode characters", () => {
    // Each "𝄞" (U+1D11E) is 4 UTF-8 bytes; .length counts 2 code units.
    // Using a known key so only the size check triggers, not the whitelist.
    const multibyteStr = "𝄞".repeat(200_000); // ~800 KB UTF-8, ~400 KB UTF-16
    const result = sanitizeSyncPayload({ history: [{ note: multibyteStr }], dayState: { runs: [], resetAt: 0 } });
    expect(result).toBeNull();
  });

  it("passes through non-object payloads (null/string/array) unchanged without error", () => {
    // sanitizeSyncPayload itself doesn't reject non-objects — it returns them
    // unchanged. The route handler is responsible for the 400 guard.
    expect(sanitizeSyncPayload(null)).toBeNull();
    expect(sanitizeSyncPayload("oops")).toBe("oops");
    expect(sanitizeSyncPayload([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("isSyncPayloadTooLarge returns true for null, false otherwise", () => {
    expect(isSyncPayloadTooLarge(null)).toBe(true);
    expect(isSyncPayloadTooLarge({ brands: ["X"] })).toBe(false);
    expect(isSyncPayloadTooLarge(undefined)).toBe(false);
  });

  it("valid normal-sized payload is not null", () => {
    const payload = {
      brands: ["A", "B"],
      pepTypes: ["Pepperoni"],
      dayState: { runs: [{ id: "r1", brand: "A", flavor: "B" }], resetAt: 0 },
      runValues: { r1: { casesNeeded: 100 } },
    };
    const result = sanitizeSyncPayload(payload);
    expect(result).not.toBeNull();
  });
});

// ── capMergedResult ──────────────────────────────────────────────────────────

describe("capMergedResult", () => {
  const MAX_BYTES = 512 * 1024;

  function byteSize(v: unknown): number {
    return Buffer.byteLength(JSON.stringify(v), "utf8");
  }

  it("passes through a small blob unchanged", () => {
    const merged = {
      brands: ["Brand A", "Brand B"],
      dayState: { runs: [], resetAt: 0 },
    };
    const result = capMergedResult(merged) as Record<string, unknown>;
    expect(result.brands).toEqual(["Brand A", "Brand B"]);
    expect(byteSize(result)).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("drops brandFlavors when blob exceeds 512 KB via disjoint pushes", () => {
    // Simulate the merged blob that results from many disjoint pushes each
    // adding distinct brandFlavors entries. 500 brands × 500 flavors × 200
    // chars each would be ~50 MB — far beyond the 512 KB limit.
    const hugeBrandFlavors: Record<string, string[]> = {};
    for (let b = 0; b < 300; b++) {
      hugeBrandFlavors[`Brand${"X".repeat(150)}_${b}`] = Array.from(
        { length: 300 },
        (_, f) => `Flavor${"Y".repeat(150)}_${f}`,
      );
    }
    const merged = {
      brands: ["Brand A"],
      brandFlavors: hugeBrandFlavors,
      dayState: { runs: [], resetAt: 0 },
    };
    expect(byteSize(merged)).toBeGreaterThan(MAX_BYTES);
    const result = capMergedResult(merged);
    expect(byteSize(result)).toBeLessThanOrEqual(MAX_BYTES);
  }, 20_000);

  it("enforces the hard 512 KB guarantee even for pathologically large retained fields", () => {
    // Build a blob with many additive arrays ALL maxed-out at 500 × 200-char strings.
    // 500 entries × 200 chars × 12 arrays ≈ 1.2 MB — well over the 512 KB limit.
    const bigList = Array.from({ length: 500 }, (_, i) => `E_${"Z".repeat(192)}_${String(i).padStart(3, "0")}`);
    const merged = {
      brands: bigList,
      pepTypes: bigList,
      ingredientTypes: bigList,
      cheeseRecipeNames: bigList,
      doughRecipeNames: bigList,
      sauceRecipeNames: bigList,
      lineNames: bigList,
      dieTypes: bigList,
      ingredientNames: bigList,
      flavors: bigList,
      dayState: { runs: [], resetAt: 0 },
    };
    expect(byteSize(merged)).toBeGreaterThan(MAX_BYTES);
    const result = capMergedResult(merged);
    expect(byteSize(result)).toBeLessThanOrEqual(MAX_BYTES);
  });
});

// ── packagingProgress merge ───────────────────────────────────────────────────

type ProgressEntry = {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  correctionGeneration: number;
  updatedAt: number;
  manualOverrideUntil: number;
  nextCaseDueAt?: number;
};

function mkProgress(
  skidsCompleted: number,
  casesOnCurrentSkid: number,
  correctionGeneration: number,
  updatedAt: number,
  manualOverrideUntil = 0,
  nextCaseDueAt?: number,
): ProgressEntry {
  return {
    skidsCompleted,
    casesOnCurrentSkid,
    correctionGeneration,
    updatedAt,
    manualOverrideUntil,
    ...(nextCaseDueAt !== undefined ? { nextCaseDueAt } : {}),
  };
}

function basePayload(
  runIds: string[],
  progress?: Record<string, ProgressEntry>,
  runValues?: Record<string, Record<string, unknown>>,
) {
  const rvs: Record<string, Record<string, unknown>> = runValues ?? {};
  for (const id of runIds) {
    if (!rvs[id]) rvs[id] = { casesNeeded: 100, skidsCompleted: 0, casesOnCurrentSkid: 0 };
  }
  const result: Record<string, unknown> = {
    dayState: { runs: runIds.map((id) => ({ id, brand: "Acme", flavor: id })), resetAt: 1000 },
    runValues: rvs,
    runValuesUpdatedAt: Object.fromEntries(runIds.map((id) => [id, 1])),
  };
  if (progress) result.packagingProgress = progress;
  return result;
}

describe("packagingProgress merge (Task 974)", () => {
  it("higher correctionGeneration always wins regardless of updatedAt", () => {
    // Stored has gen=2/updatedAt=9999 (very recent auto); incoming has gen=3/updatedAt=1 (older manual correction).
    // Higher generation (3) must always win.
    const stored = basePayload(["r1"], { r1: mkProgress(5, 3, 2, 9999) });
    const incoming = basePayload(["r1"], { r1: mkProgress(10, 7, 3, 1) });
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    expect(prog.r1.skidsCompleted).toBe(10);
    expect(prog.r1.casesOnCurrentSkid).toBe(7);
    expect(prog.r1.correctionGeneration).toBe(3);
  });

  it("same generation: higher updatedAt wins", () => {
    const stored = basePayload(["r1"], { r1: mkProgress(5, 3, 2, 1000) });
    const incoming = basePayload(["r1"], { r1: mkProgress(8, 4, 2, 2000) });
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    expect(prog.r1.skidsCompleted).toBe(8);
    expect(prog.r1.updatedAt).toBe(2000);
  });

  it("same generation AND same updatedAt: stored entry kept", () => {
    const stored = basePayload(["r1"], { r1: mkProgress(5, 3, 2, 1000) });
    const incoming = basePayload(["r1"], { r1: mkProgress(9, 9, 2, 1000) });
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    // Exact tie → stored wins
    expect(prog.r1.skidsCompleted).toBe(5);
    expect(prog.r1.casesOnCurrentSkid).toBe(3);
  });

  it("missing incoming metadata cannot clobber established stored metadata", () => {
    // Stored has packagingProgress; incoming omits it entirely (legacy client).
    const stored = basePayload(["r1"], { r1: mkProgress(4, 2, 1, 500) });
    const incoming = basePayload(["r1"]); // no packagingProgress key
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    expect(prog.r1.skidsCompleted).toBe(4); // preserved from stored
  });

  it("tombstoned runs drop metadata", () => {
    const stored = basePayload(["r1", "r2"], {
      r1: mkProgress(4, 2, 1, 500),
      r2: mkProgress(6, 1, 1, 600),
    });
    const incoming = {
      ...basePayload(["r1"]),
      deletedItems: { runs: ["r2"] },
      packagingProgress: { r1: mkProgress(4, 2, 1, 500) },
    };
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    expect(prog.r1).toBeDefined();
    expect(prog.r2).toBeUndefined(); // tombstoned
  });

  it("packagingProgress is merged independently from runValues (different stamp clocks)", () => {
    // runValues has a stale stamp (rejected); packagingProgress has a newer gen.
    const stored = basePayload(["r1"], { r1: mkProgress(2, 5, 1, 100) });
    // incoming runValues has older stamp → runValues kept from stored by LWW
    const incoming: Record<string, unknown> = {
      ...basePayload(["r1"]),
      runValuesUpdatedAt: { r1: 0 }, // older stamp
      packagingProgress: { r1: mkProgress(7, 3, 2, 50) }, // higher gen wins
    };
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    // Higher gen wins regardless of runValues LWW
    expect(prog.r1.correctionGeneration).toBe(2);
    expect(prog.r1.skidsCompleted).toBe(7);
  });

  it("overlay: winning packagingProgress values applied into canonical runValues", () => {
    const stored = basePayload(["r1"], { r1: mkProgress(2, 5, 1, 100) });
    const incoming = basePayload(["r1"], { r1: mkProgress(7, 3, 2, 50) });
    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const rv = (out.runValues as Record<string, Record<string, unknown>>).r1;
    // Winning entry has higher gen (2), so skidsCompleted=7, casesOnCurrentSkid=3
    expect(rv.skidsCompleted).toBe(7);
    expect(rv.casesOnCurrentSkid).toBe(3);
  });

  it("reset path: retains only incoming run IDs but still applies precedence for shared runs", () => {
    // Stored has runs a, b; incoming reset has only run a with lower gen.
    // Run b should be dropped; run a should keep stored entry (higher gen).
    const stored = {
      dayState: { runs: [{ id: "a", brand: "X", flavor: "a" }, { id: "b", brand: "X", flavor: "b" }], resetAt: 100 },
      runValues: { a: { casesNeeded: 100, skidsCompleted: 0, casesOnCurrentSkid: 0 }, b: { casesNeeded: 50, skidsCompleted: 0, casesOnCurrentSkid: 0 } },
      runValuesUpdatedAt: { a: 1, b: 1 },
      packagingProgress: {
        a: mkProgress(5, 2, 3, 9999), // gen=3
        b: mkProgress(1, 1, 1, 100),
      },
    };
    const incoming = {
      dayState: { runs: [{ id: "a", brand: "X", flavor: "a" }], resetAt: 200 }, // reset
      runValues: { a: { casesNeeded: 100, skidsCompleted: 0, casesOnCurrentSkid: 0 } },
      runValuesUpdatedAt: { a: 5 },
      packagingProgress: {
        a: mkProgress(3, 1, 1, 5000), // lower gen than stored
      },
    };
    const out = protectRunValues(incoming, stored, { allowRunListReplacement: true }) as Record<string, unknown>;
    const prog = out.packagingProgress as Record<string, ProgressEntry>;
    // Run b: dropped (not in incoming reset's run list)
    expect(prog.b).toBeUndefined();
    // Run a: stored has gen=3, incoming has gen=1 → stored wins
    expect(prog.a.correctionGeneration).toBe(3);
    expect(prog.a.skidsCompleted).toBe(5);
  });

  it("reset path keys progress retention to the incoming run list, not runValues keys", () => {
    const stored = {
      dayState: {
        runs: [
          { id: "listed", brand: "X", flavor: "A" },
          { id: "ghost", brand: "X", flavor: "B" },
        ],
        resetAt: 100,
      },
      runValues: {
        listed: { casesNeeded: 100 },
        ghost: { casesNeeded: 50 },
      },
      runValuesUpdatedAt: { listed: 1, ghost: 1 },
      packagingProgress: {
        listed: mkProgress(2, 4, 2, 200),
        ghost: mkProgress(1, 8, 1, 100),
      },
    };
    const incoming = {
      // "listed" intentionally has no runValues entry; "ghost" intentionally
      // has a stray value entry despite not being in the authoritative list.
      dayState: {
        runs: [{ id: "listed", brand: "X", flavor: "A" }],
        resetAt: 200,
      },
      runValues: {
        ghost: { casesNeeded: 999 },
      },
      runValuesUpdatedAt: { ghost: 999 },
      packagingProgress: {
        ghost: mkProgress(9, 9, 9, 999),
      },
    };

    const out = protectRunValues(
      incoming,
      stored,
      { allowRunListReplacement: true },
    ) as Record<string, unknown>;
    const progress = out.packagingProgress as Record<string, ProgressEntry>;

    expect(progress.listed).toEqual(stored.packagingProgress.listed);
    expect(progress.ghost).toBeUndefined();
  });

  it("reset path drops an incoming-only packaging entry absent from the run list", () => {
    const stored = {
      dayState: {
        runs: [{ id: "listed", brand: "X", flavor: "A" }],
        resetAt: 100,
      },
      runValues: { listed: { casesNeeded: 100 } },
      runValuesUpdatedAt: { listed: 1 },
      packagingProgress: {
        listed: mkProgress(2, 4, 2, 200),
      },
    };
    const incoming = {
      dayState: {
        runs: [{ id: "listed", brand: "X", flavor: "A" }],
        resetAt: 200,
      },
      runValues: { listed: { casesNeeded: 100 } },
      runValuesUpdatedAt: { listed: 2 },
      packagingProgress: {
        listed: mkProgress(2, 4, 2, 200),
        incomingOnlyGhost: mkProgress(9, 9, 9, 999),
      },
    };

    const out = protectRunValues(
      incoming,
      stored,
      { allowRunListReplacement: true },
    ) as Record<string, unknown>;
    const progress = out.packagingProgress as Record<string, ProgressEntry>;

    expect(progress.listed).toBeDefined();
    expect(progress.incomingOnlyGhost).toBeUndefined();
  });

  it("sanitizer: accepts valid packagingProgress entries and caps at MAX_RUNS", () => {
    const progress: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      progress[`r${i}`] = { skidsCompleted: i, casesOnCurrentSkid: i, correctionGeneration: 1, updatedAt: 1000, manualOverrideUntil: 0 };
    }
    const out = sanitizeSyncPayload({ packagingProgress: progress }) as Record<string, unknown>;
    expect(Object.keys(out.packagingProgress as object).length).toBe(50);
  });

  it("sanitizer: rejects packagingProgress entries with non-finite or negative numeric fields", () => {
    const out = sanitizeSyncPayload({
      packagingProgress: {
        r1: { skidsCompleted: -1, casesOnCurrentSkid: Infinity, correctionGeneration: NaN, updatedAt: 500, manualOverrideUntil: -5 },
      },
    }) as Record<string, unknown>;
    expect(out.packagingProgress).toEqual({});
  });

  it("sanitizer: keeps the optional case deadline and strips unknown keys", () => {
    const out = sanitizeSyncPayload({
      packagingProgress: {
        r1: {
          skidsCompleted: 3,
          casesOnCurrentSkid: 2,
          correctionGeneration: 1,
          updatedAt: 100,
          manualOverrideUntil: 0,
          nextCaseDueAt: 900,
          evil: "bad",
        },
      },
    }) as Record<string, unknown>;
    const e = out.packagingProgress as Record<string, Record<string, unknown>>;
    expect(Object.keys(e.r1)).toEqual(
      expect.arrayContaining([
        "skidsCompleted",
        "casesOnCurrentSkid",
        "correctionGeneration",
        "updatedAt",
        "manualOverrideUntil",
        "nextCaseDueAt",
      ]),
    );
    expect(e.r1.nextCaseDueAt).toBe(900);
    expect(e.r1).not.toHaveProperty("evil");
  });

  it("publishes a Resume-now case timer reset even when the pair is unchanged", () => {
    const stored = basePayload(
      ["r1"],
      { r1: mkProgress(0, 2, 4, 1_000, 0, 10_000) },
      { r1: { casesNeeded: 100, skidsCompleted: 0, casesOnCurrentSkid: 2 } },
    );
    stored.autoTrackCoordination = {
      version: 1,
      runs: {
        r1: {
          case: {
            generation: "r1:2",
            sequence: 7,
            nextDueAt: 10_000,
            correctionGeneration: 4,
            updatedAt: 1_000,
          },
        },
      },
    };
    const incoming = basePayload(
      ["r1"],
      { r1: mkProgress(0, 2, 5, 2_000, 0, 1_800_000_009_000) },
      { r1: { casesNeeded: 100, skidsCompleted: 0, casesOnCurrentSkid: 2 } },
    );

    const out = protectRunValues(incoming, stored) as Record<string, unknown>;
    const coordination = out.autoTrackCoordination as {
      runs: Record<string, Record<string, Record<string, number | string>>>;
    };
    expect(coordination.runs.r1.case).toMatchObject({
      generation: "r1:2",
      sequence: 8,
      nextDueAt: 1_800_000_009_000,
      correctionGeneration: 5,
    });
  });

  it("capMergedResult: caps packagingProgress at MAX_RUNS entries", () => {
    const progress: Record<string, ProgressEntry> = {};
    for (let i = 0; i < 60; i++) {
      progress[`r${i}`] = mkProgress(i, 0, 1, 1000);
    }
    const result = capMergedResult({
      packagingProgress: progress,
      dayState: { runs: [], resetAt: 0 },
      runValues: {},
      runValuesUpdatedAt: {},
    }) as Record<string, unknown>;
    expect(Object.keys(result.packagingProgress as object).length).toBe(50);
  });

  it("first write (no existing): packagingProgress overlays canonical run values", () => {
    const incoming = basePayload(["r1"], { r1: mkProgress(3, 2, 1, 100) });
    const out = protectRunValues(incoming, null) as Record<string, unknown>;
    expect(out.packagingProgress).toEqual(incoming.packagingProgress);
    expect((out.runValues as Record<string, Record<string, number>>).r1).toMatchObject({
      skidsCompleted: 3,
      casesOnCurrentSkid: 2,
    });
  });
});
