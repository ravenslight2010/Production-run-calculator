import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_CALCULATOR_TEST_BUDGET_MS,
  MIN_CALCULATOR_TEST_WORKERS,
} from "./check-test-duration.mjs";

const documentationPath = new URL(
  "../docs/performance-budgets.md",
  import.meta.url,
);

const numberWords = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
]);

function readDocumentedDurationMs(source) {
  const match = source.match(
    /The full calculator Vitest suite has a ([\d,]+)-second wall-clock validation budget\./,
  );
  assert.ok(
    match,
    "performance-budgets.md must document the full calculator Vitest suite wall-clock budget.",
  );
  return Number(match[1].replaceAll(",", "")) * 1000;
}

function readDocumentedMinimumWorkers(source) {
  const match = source.match(
    /The standard validation lane requires at least ([\d]+|one|two|three|four|five|six|seven|eight|nine|ten) available CPU workers/,
  );
  assert.ok(
    match,
    "performance-budgets.md must document the standard validation lane's minimum available CPU workers.",
  );
  return Number(match[1]) || numberWords.get(match[1]);
}

test("calculator test duration and worker prerequisite match the guide", () => {
  const documentation = readFileSync(documentationPath, "utf8");
  const documentedDurationMs = readDocumentedDurationMs(documentation);
  const documentedMinimumWorkers =
    readDocumentedMinimumWorkers(documentation);

  assert.equal(
    documentedDurationMs,
    DEFAULT_CALCULATOR_TEST_BUDGET_MS,
    `Calculator test duration drift: performance-budgets.md documents ${documentedDurationMs} ms, but check-test-duration.mjs enforces ${DEFAULT_CALCULATOR_TEST_BUDGET_MS} ms.`,
  );
  assert.equal(
    documentedMinimumWorkers,
    MIN_CALCULATOR_TEST_WORKERS,
    `Calculator test worker prerequisite drift: performance-budgets.md documents at least ${documentedMinimumWorkers} available CPU workers, but check-test-duration.mjs enforces at least ${MIN_CALCULATOR_TEST_WORKERS}.`,
  );
});
