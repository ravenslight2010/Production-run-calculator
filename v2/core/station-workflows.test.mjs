import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  calculateStationMetrics,
  deriveDoughCasesPerBatch,
  STATIONS,
  validateStationCommand,
} from "./station-workflows.mjs";

const run = { setupSnapshot: { label: "Synthetic run", targetCases: 120 } };
const floorExampleRun = { setupSnapshot: { label: "Workbook example", targetCases: 55 } };

const floorExampleSources = [
  {
    path: "../../attached_assets/source-library/cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx",
    sha256: "21432dc3c0260f578d66989830458f51c19d2524ebf0453efcf7b761e78d9878",
  },
  {
    path: "../../attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx",
    sha256: "54c6e9660c5da91e80f41180d5b181d53758d55e688ad5684e5217d130fc100c",
  },
  {
    path: "../../attached_assets/source-library/dough/Aldo's_Dough_Mixing_Procedure_-_09_1784339683714.xlsx",
    sha256: "f6d80526acda8ea185c067fc8a2ea229cfc43d3346c61423f7ba3301930d7900",
  },
  {
    path: "../../attached_assets/source-library/sauce/Aldo_Pizza_Sauce_02_1784339518984.xlsx",
    sha256: "e42ab181171c5abdbbbe17b28fdca2d2053ae22356c1cf65f0f19feb4c1d1f74",
  },
  {
    path: "../../attached_assets/source-library/shipping/Shipping_and_Palletizing_Guide_07.02.2026_1784339849858.xlsx",
    sha256: "bf76dcf04c37218e41a1a16d118922647b0e488e5264365696c65705799e8de6",
  },
  {
    path: "../../attached_assets/source-library/schedule/Production_Schedule_7-8-26_1784339875921.xlsx",
    sha256: "f7066f55fc9f335daa691a5ab4d915c3a26ccc08f8e57b5038d4bf0db119c46d",
  },
];

test("pins the exact workbook versions used by the floor examples", () => {
  for (const source of floorExampleSources) {
    const workbook = readFileSync(new URL(source.path, import.meta.url));
    const sha256 = createHash("sha256").update(workbook).digest("hex");
    assert.equal(sha256, source.sha256, `${source.path} changed; re-review its cited cells`);
  }
});

test("exposes each production workflow and its server-owned auto-track field", () => {
  assert.deepEqual(Object.keys(STATIONS), [
    "line", "dough", "cheese", "pepperoni", "sauce", "frontline", "packaging",
  ]);
  for (const station of Object.values(STATIONS)) assert.ok(station.autoTrackField);
});

test("validates station-specific manual fields and separates setup from progress", () => {
  const command = validateStationCommand({
    stationKey: "cheese",
    changes: { batchLbs: 25, casesCompleted: 5, ozPerPizza: 2.5, pizzasPerCase: 8 },
  });
  assert.deepEqual(command.inputs, { batchLbs: 25, ozPerPizza: 2.5, pizzasPerCase: 8 });
  assert.deepEqual(command.progress, { casesCompleted: 5 });
  assert.deepEqual(command.changes, {
    batchLbs: 25, casesCompleted: 5, ozPerPizza: 2.5, pizzasPerCase: 8,
  });
});

test("rejects non-finite, negative, excessive-precision, and cross-station fields", () => {
  for (const changes of [
    { casesCompleted: -1 },
    { casesCompleted: Number.NaN },
    { casesCompleted: 0.1234 },
    { casesCompleted: 0.5 },
    { casesPacked: 1 },
  ]) {
    assert.throws(() => validateStationCommand({
      stationKey: "cheese",
      changes,
    }));
  }
  assert.throws(() => validateStationCommand({
    stationKey: "cheese",
    changes: { ozPerPizza: 16.1 },
  }), /16 or less/);
  assert.throws(() => validateStationCommand({
    stationKey: "dough",
    mode: "auto_track",
    changes: { casesProduced: 10 },
  }), /does not accept client-supplied progress/);
});

test("computes ingredient pounds and batch counts from case and recipe inputs", () => {
  const result = calculateStationMetrics({
    stationKey: "cheese",
    run,
    state: {
      inputs: { pizzasPerCase: 8, ozPerPizza: 2.5, batchLbs: 25 },
      progress: { casesCompleted: 15, batchesMade: 4 },
    },
  });
  assert.deepEqual(result, {
    targetCases: 120,
    casesCompleted: 15,
    casesRemaining: 105,
    ingredientLbsNeeded: 150,
    batchesNeeded: 6,
    batchesRemaining: 2,
  });
});

test("calculates dough requirements and packaging skid remainders without negative values", () => {
  assert.deepEqual(calculateStationMetrics({
    stationKey: "dough",
    run: {
      ...run,
      doughCapacity: { status: "available", doughballYield: 360, pizzasPerCase: 12 },
    },
    state: {
      progress: { casesProduced: 125, batchesMade: 3 },
    },
  }), {
    targetCases: 120, casesProduced: 125, casesRemaining: 0,
    casesPerBatch: 30,
    batchesNeeded: 4, batchesRemaining: 1,
  });

  assert.deepEqual(calculateStationMetrics({
    stationKey: "packaging",
    run,
    state: { inputs: { casesPerSkid: 48 }, progress: { casesPacked: 98 } },
  }), {
    targetCases: 120, casesPacked: 98, casesRemaining: 22,
    skidsNeeded: 3, completedSkids: 2, casesOnCurrentSkid: 2,
  });
});

test("computes the run line state from canonical progress values", () => {
  assert.deepEqual(calculateStationMetrics({
    stationKey: "line",
    run,
    state: { progress: { casesProduced: 30, casesOnLine: 4, casesInFreezer: 3 } },
  }), {
    targetCases: 120, casesRemaining: 90, workInProgress: 7, completionPercent: 25,
  });
});

test("calculates recipe-driven ingredient demand for Cheese and Pepperoni", () => {
  for (const stationKey of ["cheese", "pepperoni"]) {
    assert.deepEqual(calculateStationMetrics({
      stationKey,
      run,
      state: {
        inputs: { pizzasPerCase: 8, ozPerPizza: 2, batchLbs: 16 },
        progress: { casesCompleted: 20, batchesMade: 3 },
      },
    }), {
      targetCases: 120,
      casesCompleted: 20,
      casesRemaining: 100,
      ingredientLbsNeeded: 120,
      batchesNeeded: 8,
      batchesRemaining: 5,
    });
  }
});

test("includes Sauce preparation loss and calculates barrel demand", () => {
  assert.deepEqual(calculateStationMetrics({
    stationKey: "sauce",
    run,
    state: {
      inputs: { pizzasPerCase: 8, ozPerPizza: 2, barrelLbs: 30 },
      progress: { barrelsMade: 2, stockBarrels: 0.5 },
    },
  }), {
    targetCases: 120,
    totalIngredientLbs: 150,
    barrelsNeeded: 5,
    barrelsMade: 2,
    barrelsRemaining: 3,
    stockBarrels: 0.5,
  });
});

test("calculates Frontline setup allowance, on-line stock, and remaining batches", () => {
  assert.deepEqual(calculateStationMetrics({
    stationKey: "frontline",
    run,
    state: {
      inputs: { pizzasPerCase: 8, ozPerPizza: 2, batchLbs: 16 },
      progress: { batchesMade: 3, stockOnLineLbs: 20, stockConsumedLbs: 10 },
    },
  }), {
    targetCases: 120,
    totalIngredientLbs: 140,
    stockOnLineLbs: 20,
    stockConsumedLbs: 10,
    batchesNeeded: 9,
    batchesToMake: 7,
    batchesMade: 3,
  });
});

test("validates required station setup and timer values", () => {
  assert.throws(() => validateStationCommand({
    stationKey: "packaging",
    changes: { casesPerSkid: 0 },
  }), /greater than zero/);
  assert.throws(() => validateStationCommand({
    stationKey: "line",
    changes: { timerDurationSeconds: 1.5 },
  }), /whole number/);
  assert.throws(() => validateStationCommand({
    stationKey: "line",
    changes: { autoTrackRatePerMinute: 600.1 },
  }), /600 or less/);

  assert.throws(() => validateStationCommand({
    stationKey: "dough",
    changes: { casesPerBatch: 53.7658 },
  }), /calculated from the selected product/);
});

test("matches the cheese workbook's explicit worked calculation", () => {
  // Cheese workbook, Edwardo sheet: 1,092 cases x 12 pizzas/case, 0.01 oz/pizza.
  // Recipe rows B29:B30 total 6.25 lb per batch.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "cheese",
    run: { setupSnapshot: { targetCases: 1092 } },
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 0.01, batchLbs: 6.25 },
      progress: { casesCompleted: 0, batchesMade: 0 },
    },
  }), {
    targetCases: 1092,
    casesCompleted: 0,
    casesRemaining: 1092,
    ingredientLbsNeeded: 8.19,
    batchesNeeded: 2,
    batchesRemaining: 2,
  });
});

test("uses the approved count-only case target for line and dough planning", () => {
  // Only schedule cell E8 (55 planned cases) is used; schedule identity and notes
  // are intentionally absent. V1's importer maps the Units column to cases.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "line",
    run: floorExampleRun,
    state: { progress: { casesProduced: 0, casesOnLine: 0, casesInFreezer: 0 } },
  }), {
    targetCases: 55,
    casesRemaining: 55,
    workInProgress: 0,
    completionPercent: 0,
  });

  // Owner-approved capacity preserves the 645.19 doughballs/batch yield:
  // 645.19 / 12 pizzas per case = 53.7658 cases per batch.
  const calculatedYieldFromRecipeInputs = (310.5 * 16) / 7.7;
  const approvedDoughballYield = 645.19;
  assert.ok(Math.abs(calculatedYieldFromRecipeInputs - approvedDoughballYield) < 0.01);
  assert.deepEqual(calculateStationMetrics({
    stationKey: "dough",
    run: {
      ...floorExampleRun,
      doughCapacity: { status: "available", doughballYield: approvedDoughballYield, pizzasPerCase: 12 },
    },
    state: {
      progress: { casesProduced: 0, batchesMade: 0 },
    },
  }), {
    targetCases: 55,
    casesProduced: 0,
    casesRemaining: 55,
    casesPerBatch: 53.7658,
    batchesNeeded: 2,
    batchesRemaining: 2,
  });
});

test("matches workbook-based recipe pounds, station allowances, and skid target", () => {
  // Specs OZ sheet B24 gives 2.90 oz/pizza; cheese recipe B13:B17 totals 55.6 lb.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "cheese",
    run: floorExampleRun,
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 2.9, batchLbs: 55.6 },
      progress: { casesCompleted: 0, batchesMade: 0 },
    },
  }), {
    targetCases: 55,
    casesCompleted: 0,
    casesRemaining: 55,
    ingredientLbsNeeded: 119.63,
    batchesNeeded: 3,
    batchesRemaining: 3,
  });

  // Specs OZ sheet C25 gives 1.90 oz/pizza. No positive pepperoni batch weight
  // is present in the cited workbooks, so the batch count remains unknown.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "pepperoni",
    run: floorExampleRun,
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 1.9 },
      progress: { casesCompleted: 0, batchesMade: 0 },
    },
  }), {
    targetCases: 55,
    casesCompleted: 0,
    casesRemaining: 55,
    ingredientLbsNeeded: 78.38,
    batchesNeeded: null,
    batchesRemaining: null,
  });

  // Specs OZ sheet B23 gives 4 oz/pizza; the sauce procedure totals 271.5 lb.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "sauce",
    run: floorExampleRun,
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 4, barrelLbs: 271.5 },
      progress: { barrelsMade: 0, stockBarrels: 0 },
    },
  }), {
    targetCases: 55,
    totalIngredientLbs: 195,
    barrelsNeeded: 0.72,
    barrelsMade: 0,
    barrelsRemaining: 1,
    stockBarrels: 0,
  });

  // Frontline uses the source cheese-mix rate and recipe size. 20 lb on line
  // plus 10 lb already consumed are explicit test-state values, not workbook data.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "frontline",
    run: floorExampleRun,
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 2.9, batchLbs: 55.6 },
      progress: { batchesMade: 0, stockOnLineLbs: 20, stockConsumedLbs: 10 },
    },
  }), {
    targetCases: 55,
    totalIngredientLbs: 139.63,
    stockOnLineLbs: 20,
    stockConsumedLbs: 10,
    batchesNeeded: 3,
    batchesToMake: 2,
    batchesMade: 0,
  });

  // Shipping guide gives 60 cases/skid; the approved count-only target is 55.
  assert.deepEqual(calculateStationMetrics({
    stationKey: "packaging",
    run: floorExampleRun,
    state: { inputs: { casesPerSkid: 60 }, progress: { casesPacked: 0 } },
  }), {
    targetCases: 55,
    casesPacked: 0,
    casesRemaining: 55,
    skidsNeeded: 1,
    completedSkids: 0,
    casesOnCurrentSkid: 0,
  });
});

test("preserves fractional workbook yield at dough batch boundaries", () => {
  const yieldDoughballsPerBatch = 645.19;
  const pizzasPerCase = 12;
  const batchesAt = (targetCases) => calculateStationMetrics({
    stationKey: "dough",
    run: {
      setupSnapshot: { targetCases },
      doughCapacity: { status: "available", doughballYield: yieldDoughballsPerBatch, pizzasPerCase },
    },
    state: { progress: { batchesMade: 0 } },
  }).batchesNeeded;
  assert.equal(deriveDoughCasesPerBatch({ doughballYield: yieldDoughballsPerBatch, pizzasPerCase }), 53.7658);

  assert.deepEqual(
    [batchesAt(53), batchesAt(54), batchesAt(107), batchesAt(108)],
    [1, 2, 2, 3],
  );
});

test("dough capacity is unavailable rather than taken from a stale manual value", () => {
  assert.equal(deriveDoughCasesPerBatch({ doughballYield: 645.19, pizzasPerCase: 0 }), null);
  assert.equal(deriveDoughCasesPerBatch({ doughballYield: null, pizzasPerCase: 12 }), null);
  assert.deepEqual(calculateStationMetrics({
    stationKey: "dough",
    run: { setupSnapshot: { targetCases: 54 }, doughCapacity: { status: "unavailable", reasons: ["shipping_source_missing"] } },
    state: { inputs: { casesPerBatch: 53.7658 }, progress: { batchesMade: 0, casesProduced: 0 } },
  }), {
    targetCases: 54,
    casesProduced: 0,
    casesRemaining: 54,
    casesPerBatch: null,
    batchesNeeded: null,
    batchesRemaining: null,
  });
});

test("covers Sauce barrel, Frontline supply, and Packaging skid boundaries", () => {
  const sauceForCases = (targetCases) => calculateStationMetrics({
    stationKey: "sauce",
    run: { setupSnapshot: { targetCases } },
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 4, barrelLbs: 271.5 },
      progress: { barrelsMade: 0 },
    },
  });
  assert.deepEqual(
    [sauceForCases(80).barrelsNeeded, sauceForCases(81).barrelsNeeded],
    [0.99, 1.01],
  );
  assert.deepEqual(
    [sauceForCases(80).barrelsRemaining, sauceForCases(81).barrelsRemaining],
    [1, 2],
  );

  const frontlineAtSupply = (stockOnLineLbs) => calculateStationMetrics({
    stationKey: "frontline",
    run: floorExampleRun,
    state: {
      inputs: { pizzasPerCase: 12, ozPerPizza: 2.9, batchLbs: 55.6 },
      progress: { stockOnLineLbs, stockConsumedLbs: 50 },
    },
  }).batchesToMake;
  assert.equal(frontlineAtSupply(89.629), 1);
  assert.equal(frontlineAtSupply(89.63), 0);

  const packagingAt = (casesPacked) => calculateStationMetrics({
    stationKey: "packaging",
    run: floorExampleRun,
    state: { inputs: { casesPerSkid: 60 }, progress: { casesPacked } },
  });
  assert.deepEqual(
    [59, 60, 61].map((casesPacked) => {
      const result = packagingAt(casesPacked);
      return [result.completedSkids, result.casesOnCurrentSkid];
    }),
    [[0, 59], [1, 0], [1, 1]],
  );
});

test("caps line completion and work-in-progress at valid boundaries", () => {
  assert.deepEqual(calculateStationMetrics({
    stationKey: "line",
    run: floorExampleRun,
    state: { progress: { casesProduced: 56, casesOnLine: 3, casesInFreezer: 4 } },
  }), {
    targetCases: 55,
    casesRemaining: 0,
    workInProgress: 7,
    completionPercent: 100,
  });
  assert.throws(() => calculateStationMetrics({
    stationKey: "line",
    run: { setupSnapshot: { targetCases: 0 } },
    state: { progress: {} },
  }), /valid target case count/);
});
