import { describe, it, expect } from "vitest";
import { computeReorderList, type ReorderInput } from "@workspace/inventory-math";
import {
  buildReorderDemandByKey,
  computeRunReorderList,
  type InventoryItem,
} from "./inventoryShared";
import { DEFAULT_VALUES, type FormValues } from "./types";

// Guard for Task #253's whole point: the proactive "reorder now" NUDGE must
// subtract the SAME upcoming scheduled-run demand as the warehouse "Reorder Now"
// CARD, so the two can never contradict each other. Both clients resolve their
// scheduled runs to FormValues and aggregate them with the SHARED
// `buildReorderDemandByKey`; the card runs `computeReorderList` locally while the
// nudge ships that demand map to the server which runs the same
// `computeReorderList`. This test drives both code paths off ONE inventory +
// scheduled-run set and asserts the nudge's flagged items are always a subset of
// (or equal to) the card's. A future change to how either side resolves
// scheduled-run demand would re-introduce the divergence and fail here.

// A scheduled run as it lives in `scheduledDays` (no recipe rows — those are
// resolved from the brand profile, exactly like home.tsx does).
type SchedRun = { brand: string; flavor: string; casesNeeded: number; dieType: string };
type SchedDay = { date: string; runs?: SchedRun[] };

// Mirror the client's resolution (home.tsx, both the nudge builder and the
// ReorderCard block use this identical shape): keep only today-or-later days,
// drop runs with no brand, resolve each run via its saved profile or fall back
// to DEFAULT_VALUES when the profile is missing, then stamp casesNeeded/dieType.
// The today-or-later filter is the parity-critical step (see reorder-list.md):
// a past-dated leak here would inflate demand on one side only.
function resolveScheduledValsList(
  days: SchedDay[],
  loadProfile: (brand: string, flavor: string) => FormValues | null,
  today: string,
): FormValues[] {
  return days
    .filter((d) => d.date >= today)
    .flatMap((day) =>
      (day.runs ?? [])
        .filter((r) => r.brand)
        .map((r) => {
          const profile = loadProfile(r.brand, r.flavor);
          return {
            ...(profile ?? DEFAULT_VALUES),
            casesNeeded: r.casesNeeded,
            ...(r.dieType ? { dieType: r.dieType } : {}),
          } as FormValues;
        }),
    );
}

// Build the server's reorder inputs from the same inventory the card reads
// (mirrors the API server mapping its DB rows into ReorderInput).
function toReorderInputs(items: InventoryItem[]): ReorderInput[] {
  return items.map((it) => ({
    key: it.key,
    name: it.name,
    unit: it.unit,
    category: it.category as ReorderInput["category"],
    onHand: it.onHand,
    reorderThreshold: it.reorderThreshold,
  }));
}

// The NUDGE path: client aggregates demand with the shared helper and ships the
// map; the server feeds it straight into computeReorderList. `demandOverride`
// simulates the server's best-effort fallback (a missing/empty map → no-demand).
function nudgeFlaggedKeys(
  items: InventoryItem[],
  scheduledValsList: FormValues[],
  demandOverride?: Record<string, number>,
): string[] {
  const demandByKey = demandOverride ?? buildReorderDemandByKey(scheduledValsList);
  return computeReorderList(toReorderInputs(items), demandByKey)
    .map((r) => r.key)
    .sort();
}

// The CARD path: the warehouse card resolves demand and flags items locally.
function cardFlaggedKeys(items: InventoryItem[], scheduledValsList: FormValues[]): string[] {
  return computeRunReorderList(items, scheduledValsList)
    .map((r) => r.key)
    .sort();
}

function assertSubset(nudge: string[], card: string[]): void {
  for (const k of nudge) {
    expect(card, `nudge flagged "${k}" but the card did not`).toContain(k);
  }
}

function item(over: Partial<InventoryItem>): InventoryItem {
  return {
    id: over.id ?? 1,
    key: over.key ?? "ingredient:Cheese Mix:lbs",
    category: over.category ?? "ingredient",
    name: over.name ?? "Cheese Mix",
    unit: over.unit ?? "lbs",
    reorderThreshold: over.reorderThreshold ?? 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    onHand: over.onHand ?? 0,
    lots: [],
    byLocation: [],
  } as InventoryItem;
}

const TODAY = "2026-06-24";
const FUTURE = "2026-06-25";
const PAST = "2026-06-23";

// A profile whose run consumes a "mix"-type applicator → demand lands on the
// stable key `ingredient:Cheese Mix:lbs` (mix types are tracked in lbs).
const CHEESE_BRAND = "Acme";
const CHEESE_FLAVOR = "Cheese";
const cheeseProfile: FormValues = {
  ...DEFAULT_VALUES,
  pizzasPerCase: 4,
  app1Type: "Cheese Mix",
  app1OzPerPizza: 8,
  app1BatchLbs: 25,
};

function loadCheeseProfile(brand: string, flavor: string): FormValues | null {
  if (brand === CHEESE_BRAND && flavor === CHEESE_FLAVOR) return cheeseProfile;
  return null; // any other brand has no saved profile (missing-profile run)
}

const CHEESE_KEY = "ingredient:Cheese Mix:lbs";

describe("reorder nudge vs. warehouse card parity", () => {
  it("flags the identical set when both paths get the same scheduled demand", () => {
    const days: SchedDay[] = [
      { date: FUTURE, runs: [{ brand: CHEESE_BRAND, flavor: CHEESE_FLAVOR, casesNeeded: 100, dieType: "" }] },
    ];
    const scheduled = resolveScheduledValsList(days, loadCheeseProfile, TODAY);

    // Sanity: the scheduled run actually produces demand on the cheese key,
    // otherwise this test would pass trivially.
    const demand = buildReorderDemandByKey(scheduled);
    expect(demand[CHEESE_KEY]).toBeGreaterThan(0);

    // On-hand is fine today (above threshold) but the scheduled demand pulls
    // projected on-hand to/below threshold → both paths must flag it.
    const items = [
      item({ key: CHEESE_KEY, onHand: demand[CHEESE_KEY] + 5, reorderThreshold: 10 }),
    ];

    const nudge = nudgeFlaggedKeys(items, scheduled);
    const card = cardFlaggedKeys(items, scheduled);
    expect(nudge).toEqual([CHEESE_KEY]);
    expect(card).toEqual(nudge); // equal → trivially a subset
    assertSubset(nudge, card);
  });

  it("excludes past-dated scheduled runs from demand on BOTH paths", () => {
    // Same run, but dated yesterday. The today-or-later filter must drop it, so
    // neither path sees any demand and an item that is only short BECAUSE of
    // that demand must NOT be flagged by either side.
    const pastDays: SchedDay[] = [
      { date: PAST, runs: [{ brand: CHEESE_BRAND, flavor: CHEESE_FLAVOR, casesNeeded: 100, dieType: "" }] },
    ];
    const futureDays: SchedDay[] = [
      { date: FUTURE, runs: [{ brand: CHEESE_BRAND, flavor: CHEESE_FLAVOR, casesNeeded: 100, dieType: "" }] },
    ];

    const pastScheduled = resolveScheduledValsList(pastDays, loadCheeseProfile, TODAY);
    const futureScheduled = resolveScheduledValsList(futureDays, loadCheeseProfile, TODAY);

    // The past day contributes nothing; the future day does.
    expect(pastScheduled).toHaveLength(0);
    expect(buildReorderDemandByKey(pastScheduled)).toEqual({});
    expect(buildReorderDemandByKey(futureScheduled)[CHEESE_KEY]).toBeGreaterThan(0);

    const futureDemand = buildReorderDemandByKey(futureScheduled)[CHEESE_KEY];
    // On-hand sits just above threshold: only the (excluded) past demand could
    // have pushed it under. With the past run correctly dropped, nothing flags.
    const items = [
      item({ key: CHEESE_KEY, onHand: futureDemand + 5, reorderThreshold: 10 }),
    ];

    const nudge = nudgeFlaggedKeys(items, pastScheduled);
    const card = cardFlaggedKeys(items, pastScheduled);
    expect(nudge).toEqual([]);
    expect(card).toEqual([]);
    assertSubset(nudge, card);
  });

  it("handles a missing-profile scheduled run without flagging spurious items", () => {
    // A run whose brand has no saved profile resolves to DEFAULT_VALUES (empty
    // recipe, circles "none", no shipper) → contributes no demand. It must not
    // crash either path nor flag anything on its own.
    const days: SchedDay[] = [
      { date: FUTURE, runs: [{ brand: "Unknown", flavor: "Mystery", casesNeeded: 100, dieType: "" }] },
    ];
    const scheduled = resolveScheduledValsList(days, loadCheeseProfile, TODAY);
    expect(scheduled).toHaveLength(1); // resolved (to DEFAULT_VALUES), not dropped
    expect(buildReorderDemandByKey(scheduled)).toEqual({});

    const items = [
      item({ key: CHEESE_KEY, onHand: 50, reorderThreshold: 10 }), // comfortably above
    ];
    const nudge = nudgeFlaggedKeys(items, scheduled);
    const card = cardFlaggedKeys(items, scheduled);
    expect(nudge).toEqual([]);
    expect(card).toEqual([]);
    assertSubset(nudge, card);
  });

  it("keeps the nudge a subset of the card across a mixed scheduled set", () => {
    // A realistic mix: a future cheese run (real demand), a past run (excluded),
    // a brandless run (dropped), and a missing-profile run (no demand). Both
    // paths must agree, and the subset invariant must hold.
    const days: SchedDay[] = [
      { date: FUTURE, runs: [{ brand: CHEESE_BRAND, flavor: CHEESE_FLAVOR, casesNeeded: 80, dieType: "" }] },
      { date: PAST, runs: [{ brand: CHEESE_BRAND, flavor: CHEESE_FLAVOR, casesNeeded: 999, dieType: "" }] },
      { date: FUTURE, runs: [{ brand: "", flavor: "x", casesNeeded: 50, dieType: "" }] },
      { date: FUTURE, runs: [{ brand: "Unknown", flavor: "Mystery", casesNeeded: 40, dieType: "" }] },
    ];
    const scheduled = resolveScheduledValsList(days, loadCheeseProfile, TODAY);
    // Only the future cheese run + the missing-profile run survive; brandless and
    // past are gone.
    expect(scheduled).toHaveLength(2);

    const demand = buildReorderDemandByKey(scheduled);
    expect(demand[CHEESE_KEY]).toBeGreaterThan(0);

    const items = [
      item({ key: CHEESE_KEY, onHand: demand[CHEESE_KEY] + 3, reorderThreshold: 10 }),
      item({ key: "ingredient:Flour:lbs", name: "Flour", onHand: 5, reorderThreshold: 20 }), // low regardless of demand
      item({ key: "ingredient:Salt:lbs", name: "Salt", onHand: 100, reorderThreshold: 5 }), // never low
    ];

    const card = cardFlaggedKeys(items, scheduled);
    // Card flags the cheese (demand-driven) and the flour (already low).
    expect(card).toEqual(["ingredient:Cheese Mix:lbs", "ingredient:Flour:lbs"]);

    // Full-map nudge: identical to the card.
    assertSubset(nudgeFlaggedKeys(items, scheduled), card);
    expect(nudgeFlaggedKeys(items, scheduled)).toEqual(card);

    // Best-effort fallback: the server got an EMPTY demand map (the client's map
    // failed to arrive). The cheese item is no longer demand-short, so the nudge
    // flags only the already-low flour — a strict subset of the card. The nudge
    // must never flag something the card didn't.
    const fallback = nudgeFlaggedKeys(items, scheduled, {});
    expect(fallback).toEqual(["ingredient:Flour:lbs"]);
    assertSubset(fallback, card);
  });
});
