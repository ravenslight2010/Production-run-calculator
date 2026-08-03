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
  tempFreezerTime: 0,
  tempCrustsPerCycle: 0,
  tempCycleSpeed: 0,
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

  it("list union does NOT apply during a wholesale daily reset (fresh-day wipe is intentional)", () => {
    // exReset > 0 && inReset > exReset → wholesale adopt path, no union protection.
    const existing = {
      ...base,
      dayState: { runs: [], resetAt: 100 },
      brands: ["Old Brand"],
      brandFlavors: { "Old Brand": ["Flavor X"] },
    };
    const incoming = {
      ...base,
      dayState: { runs: [], resetAt: 200 }, // strictly newer → wholesale adopt
      brands: [],
      brandFlavors: {},
    };
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    // Wholesale reset: incoming wins; brands may be empty (intentional reset)
    // The test confirms the union guard does NOT fire here.
    // (The existing reset path returns before reaching the union block.)
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

  it("carries stamp maps across a wholesale daily-reset adoption", () => {
    const existing = { ...base, dayState: { runs: [], resetAt: 100 }, undeletedStamps: { [ns]: { "house special": 500 } } };
    const incoming = { ...base, dayState: { runs: [], resetAt: 200 } }; // strictly-newer reset
    const out = protectRunValues(incoming, existing) as Record<string, unknown>;
    expect(out.undeletedStamps).toEqual({ [ns]: { "house special": 500 } });
  });

  it("ignores junk stamp values and omits empty maps", () => {
    const incoming = { ...base, deletedStamps: { [ns]: { bad: "x", zero: 0 } } };
    const out = protectRunValues(incoming, { ...base }) as Record<string, unknown>;
    expect(out.deletedStamps).toBeUndefined();
    expect(out.undeletedStamps).toBeUndefined();
  });
});
