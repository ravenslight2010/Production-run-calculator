// @vitest-environment node
//
// Coverage for the WEB re-import case-update offer builder
// (src/importCaseUpdates.ts), extracted from the inline caseUpdateOffers block
// in home.tsx's commitMultiDayImport. Re-importing today's schedule can list a
// DIFFERENT case count for a run that's already going; buildCaseUpdateOffers
// turns those skipAlreadyRanRuns matches into offers and must flag (via
// `madeAlready`) offers whose new target is BELOW what the floor already
// produced — accepting one makes the run instantly "over target". A regression
// here (flag missing, flag on the wrong side, finished runs picked up, warning
// line dropped) would only be caught on the floor, so it's locked down here,
// including a parity assertion against the mobile module
// (artifacts/run-calculator-mobile/utils/importCaseUpdates.ts) loaded via the
// strip-imports -> transpile -> temp-file-import pipeline documented in
// .agents/memory/web-test-harness.md.

import { describe, it, expect } from "vitest";

import {
  buildCaseUpdateOffers,
  defaultCaseUpdateAccepted,
  caseUpdateWarningLine,
  casesMadeFromValues,
  type CaseUpdateOffer,
  type RunCaseFields,
  type SkippedRowMatch,
} from "./importCaseUpdates";

// ---------------------------------------------------------------------------
// Web-side helpers
// ---------------------------------------------------------------------------

/** One match + a values store, mirroring how home.tsx feeds the builder. */
function scenario(
  rowCases: number,
  run: { id?: string; inProgress?: boolean },
  vals: RunCaseFields,
): { matches: SkippedRowMatch[]; getValues: (runId: string) => RunCaseFields } {
  const id = run.id ?? "run-1";
  const store: Record<string, RunCaseFields> = { [id]: vals };
  return {
    matches: [
      {
        row: { brand: "Acme", flavor: "Pepperoni", casesPlanned: rowCases },
        run: { id, inProgress: run.inProgress ?? true },
      },
    ],
    getValues: (runId) => store[runId] ?? {},
  };
}

/** Form values whose skid counters add up to `made` cases (web stores
 *  progress as skidsCompleted*casesPerSkid + casesOnCurrentSkid). */
function valuesMade(casesNeeded: number, made?: number): RunCaseFields {
  return {
    casesNeeded,
    ...(made != null
      ? { skidsCompleted: 0, casesPerSkid: 100, casesOnCurrentSkid: made }
      : {}),
  };
}

describe("buildCaseUpdateOffers (web) — lowered-target flag (madeAlready)", () => {
  it("sets madeAlready only when cases made exceeds the new target", () => {
    const s = scenario(60, {}, valuesMade(100, 80));
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      runId: "run-1",
      from: 100,
      to: 60,
      madeAlready: 80,
    });
  });

  it("does NOT set madeAlready when cases made equals the new target", () => {
    const s = scenario(80, {}, valuesMade(100, 80));
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers).toHaveLength(1);
    expect(offers[0].to).toBe(80);
    expect(offers[0].madeAlready).toBeUndefined();
    expect("madeAlready" in offers[0]).toBe(false);
  });

  it("does NOT set madeAlready when the target is raised above what was made", () => {
    const s = scenario(120, {}, valuesMade(100, 80));
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ from: 100, to: 120 });
    expect(offers[0].madeAlready).toBeUndefined();
  });

  it("does NOT set madeAlready when the skid counters are missing (0 made)", () => {
    const s = scenario(60, {}, valuesMade(100));
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ from: 100, to: 60 });
    expect(offers[0].madeAlready).toBeUndefined();
  });

  it("clamps negative cases-made to 0 (never flags)", () => {
    const s = scenario(60, {}, valuesMade(100, -5));
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers).toHaveLength(1);
    expect(offers[0].madeAlready).toBeUndefined();
  });

  it("rounds cases-made before comparing (80.4 vs target 80 -> no flag; 80.6 -> flag)", () => {
    const noFlag = scenario(80, {}, valuesMade(100, 80.4));
    expect(buildCaseUpdateOffers(noFlag.matches, noFlag.getValues)[0].madeAlready).toBeUndefined();

    const flagged = scenario(80, {}, valuesMade(100, 80.6));
    expect(buildCaseUpdateOffers(flagged.matches, flagged.getValues)[0].madeAlready).toBe(81);
  });

  it("computes cases made from all three skid fields (2*50+7=107 > 100 flags)", () => {
    const s = scenario(
      100,
      {},
      { casesNeeded: 150, skidsCompleted: 2, casesPerSkid: 50, casesOnCurrentSkid: 7 },
    );
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers[0].madeAlready).toBe(107);
    expect(casesMadeFromValues({ skidsCompleted: 2, casesPerSkid: 50, casesOnCurrentSkid: 7 })).toBe(107);
  });

  it("treats non-numeric form strings as 0 (web forms hold strings)", () => {
    const s = scenario(60, {}, {
      casesNeeded: "100",
      skidsCompleted: "",
      casesPerSkid: "abc",
      casesOnCurrentSkid: undefined,
    });
    const offers = buildCaseUpdateOffers(s.matches, s.getValues);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ from: 100, to: 60 });
    expect(offers[0].madeAlready).toBeUndefined();
  });
});

describe("buildCaseUpdateOffers (web) — offer eligibility", () => {
  it("finished/not-in-progress runs never produce offers, even lowered ones", () => {
    const s = scenario(60, { inProgress: false }, valuesMade(100, 80));
    expect(buildCaseUpdateOffers(s.matches, s.getValues)).toEqual([]);
  });

  it("no offer when the re-imported count matches the current target", () => {
    const s = scenario(100, {}, valuesMade(100, 80));
    expect(buildCaseUpdateOffers(s.matches, s.getValues)).toEqual([]);
  });

  it("ignores non-finite or non-positive re-imported counts", () => {
    for (const bad of [NaN, 0, -4]) {
      const s = scenario(bad, {}, valuesMade(100));
      expect(buildCaseUpdateOffers(s.matches, s.getValues)).toEqual([]);
    }
  });

  it("mixes flagged and unflagged offers across multiple matches", () => {
    const store: Record<string, RunCaseFields> = {
      a: valuesMade(100, 80),
      b: valuesMade(100, 80),
      c: valuesMade(100, 80),
    };
    const matches: SkippedRowMatch[] = [
      { row: { brand: "Acme", flavor: "Pepperoni", casesPlanned: 60 }, run: { id: "a", inProgress: true } },
      { row: { brand: "Acme", flavor: "Pepperoni", casesPlanned: 150 }, run: { id: "b", inProgress: true } },
      { row: { brand: "Acme", flavor: "Pepperoni", casesPlanned: 90 }, run: { id: "c", inProgress: false } },
    ];
    const offers = buildCaseUpdateOffers(matches, (id) => store[id] ?? {});
    expect(offers.map((o) => o.runId)).toEqual(["a", "b"]);
    expect(offers[0].madeAlready).toBe(80);
    expect(offers[1].madeAlready).toBeUndefined();
  });
});

describe("defaultCaseUpdateAccepted — flagged offers default to Keep", () => {
  it("defaults flagged offers to Keep (false) and plain offers to Accept (true)", () => {
    const flagged: CaseUpdateOffer = { runId: "a", brand: "B", flavor: "F", from: 100, to: 60, madeAlready: 80 };
    const plain: CaseUpdateOffer = { runId: "b", brand: "B", flavor: "F", from: 100, to: 150 };
    expect(defaultCaseUpdateAccepted([flagged, plain])).toEqual({ a: false, b: true });
    expect(defaultCaseUpdateAccepted([])).toEqual({});
  });
});

describe("caseUpdateWarningLine — lowered-target warning text", () => {
  it("renders the 'Already made N ... below' line only for flagged offers", () => {
    const flagged: CaseUpdateOffer = { runId: "a", brand: "B", flavor: "F", from: 100, to: 60, madeAlready: 80 };
    const line = caseUpdateWarningLine(flagged);
    expect(line).toContain("⚠ Already made 80");
    expect(line).toContain("the new target of 60 is below that");
    expect(line).toContain("over target");

    const plain: CaseUpdateOffer = { runId: "b", brand: "B", flavor: "F", from: 100, to: 150 };
    expect(caseUpdateWarningLine(plain)).toBeNull();
  });
});

