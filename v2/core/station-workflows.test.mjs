import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateStationMetrics,
  STATIONS,
  validateStationCommand,
} from "./station-workflows.mjs";

const run = { setupSnapshot: { label: "Synthetic run", targetCases: 120 } };

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
    run,
    state: {
      inputs: { casesPerBatch: 30 },
      progress: { casesProduced: 125, batchesMade: 3 },
    },
  }), {
    targetCases: 120, casesProduced: 125, casesRemaining: 0,
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
});
