import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRepositoryNodeVersionContract,
  checkRoutineNodeVersion,
  readCiNodeVersions,
  readNodeSelectorVersion,
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

test("accepts matching selector, CI pins, and retained evidence", () => {
  assert.doesNotThrow(() =>
    checkRepositoryNodeVersionContract({
      requiredVersion: "24.20.0",
      selectorVersion: "24.20.0",
      ciVersions: ["24.20.0", "24.20.0"],
    }),
  );
});

test("rejects selector or CI pins that drift from retained evidence", () => {
  assert.throws(
    () =>
      checkRepositoryNodeVersionContract({
        requiredVersion: "24.20.0",
        selectorVersion: "24.19.1",
        ciVersions: ["24.20.0", "24.21.0"],
      }),
    (error) => {
      assert.match(error.message, /Retained evidence: 24\.20\.0/);
      assert.match(error.message, /\.nvmrc selector: 24\.19\.1/);
      assert.match(error.message, /Explicit CI pins: 24\.20\.0, 24\.21\.0/);
      assert.match(error.message, /without rewriting retained evidence/);
      return true;
    },
  );
});

test("reads the local selector and every explicit CI Node pin", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "node-contract-"));
  const selectorPath = path.join(directory, ".nvmrc");
  const workflowPath = path.join(directory, "ci.yml");
  fs.writeFileSync(selectorPath, "24.20.0\n");
  fs.writeFileSync(
    workflowPath,
    [
      "steps:",
      "  - uses: actions/setup-node@pinned",
      "    with:",
      "      node-version: 24.20.0",
      "  - uses: actions/setup-node@pinned",
      "    with:",
      '      node-version: "24.20.0" # exact runtime',
      "",
    ].join("\n"),
  );

  try {
    assert.equal(readNodeSelectorVersion(selectorPath), "24.20.0");
    assert.deepEqual(readCiNodeVersions(workflowPath), ["24.20.0", "24.20.0"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});