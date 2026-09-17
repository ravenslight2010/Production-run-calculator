import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRoutineNodeVersion,
  readRequiredNodeVersion,
} from "./check-routine-node-version.mjs";

test("accepts the exact evidence-bound Node version", () => {
  assert.doesNotThrow(() =>
    checkRoutineNodeVersion({
      actualVersion: "24.20.0",
      requiredVersion: "24.20.0",
    }),
  );
});

test("reports actual, required, and safe reproduction details on mismatch", () => {
  assert.throws(
    () =>
      checkRoutineNodeVersion({
        actualVersion: "24.13.0",
        requiredVersion: "24.20.0",
      }),
    (error) => {
      assert.match(error.message, /Actual Node version: 24\.13\.0/);
      assert.match(error.message, /Required Node version: 24\.20\.0/);
      assert.match(
        error.message,
        /npx --yes --package=node@24\.20\.0 -- pnpm --filter @workspace\/scripts run test/,
      );
      assert.match(error.message, /did not rewrite retained evidence/);
      return true;
    },
  );
});

test("reads the required version without changing retained evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePath = path.join(directory, "evidence.json");
  const contents = `${JSON.stringify({
    evaluationManifest: { dependencies: { node: "24.20.0" } },
  })}\n`;
  fs.writeFileSync(evidencePath, contents);

  try {
    assert.equal(readRequiredNodeVersion(evidencePath), "24.20.0");
    assert.equal(fs.readFileSync(evidencePath, "utf8"), contents);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});