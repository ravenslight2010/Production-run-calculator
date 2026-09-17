import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRepositoryNodeVersionContract,
  checkRoutineNodeVersion,
  discoverRetainedEvaluationPaths,
  readAllCiNodeVersions,
  readCiNodeVersions,
  readNodeSelectorVersion,
  readRequiredNodeVersion,
  readRequiredNodeVersions,
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

test("reads every retained evaluation manifest without changing evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePaths = ["corpus.json", "reviewer.json"].map((name) =>
    path.join(directory, name),
  );
  const contents = [
    `${JSON.stringify({
      manifestVersion: 1,
      dependencies: { node: "24.20.0" },
      retainedEvidenceIndex: 0,
    })}\n`,
    `${JSON.stringify({
      evaluationManifest: {
        manifestVersion: 1,
        dependencies: { node: "24.20.0" },
      },
      retainedEvidenceIndex: 1,
    })}\n`,
  ];
  evidencePaths.forEach((evidencePath, index) => {
    fs.writeFileSync(evidencePath, contents[index]);
  });

  try {
    assert.deepEqual(readRequiredNodeVersions(evidencePaths), [
      "24.20.0",
      "24.20.0",
    ]);
    evidencePaths.forEach((evidencePath, index) => {
      assert.equal(fs.readFileSync(evidencePath, "utf8"), contents[index]);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("discovers direct-root and wrapped manifests in supported evidence locations", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const nestedDirectory = path.join(directory, "nested");
  fs.mkdirSync(nestedDirectory);
  const paths = [
    path.join(directory, "direct.json"),
    path.join(nestedDirectory, "wrapped.json"),
    path.join(directory, "unrelated.json"),
  ];
  fs.writeFileSync(
    paths[0],
    JSON.stringify({ manifestVersion: 1, dependencies: { node: "24.20.0" } }),
  );
  fs.writeFileSync(
    paths[1],
    JSON.stringify({
      evaluationManifest: {
        manifestVersion: 1,
        dependencies: { node: "24.20.0" },
      },
    }),
  );
  fs.writeFileSync(paths[2], JSON.stringify({ schemaVersion: 1 }));

  try {
    assert.deepEqual(discoverRetainedEvaluationPaths([directory]), [
      paths[0],
      paths[1],
    ]);
    assert.deepEqual(readRequiredNodeVersions([paths[0], paths[1]]), [
      "24.20.0",
      "24.20.0",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails clearly for malformed retained evidence but ignores malformed documentation JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePath = path.join(directory, "evaluation-manifest.json");
  const malformedDocumentationPath = path.join(
    directory,
    "unrelated-documentation.json",
  );
  const sensitivePayload = "private-evaluation-payload";
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      manifestVersion: 1,
      dependencies: { node: "24.20.0" },
    }),
  );
  fs.writeFileSync(malformedDocumentationPath, '{"documentation":');

  try {
    assert.deepEqual(discoverRetainedEvaluationPaths([directory]), [
      evidencePath,
    ]);

    fs.writeFileSync(
      evidencePath,
      `{"evaluationManifest":{"dependencies":{"node":"24.20.0"},"note":"${sensitivePayload}"`,
    );
    assert.throws(
      () => discoverRetainedEvaluationPaths([directory]),
      (error) => {
        assert.equal(
          error.message,
          `Malformed retained evaluation JSON: ${evidencePath}`,
        );
        assert.doesNotMatch(error.message, new RegExp(sensitivePayload));
        assert.doesNotMatch(error.message, /Unexpected token/);
        return true;
      },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails when a discovered retained manifest lacks runtime metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePath = path.join(directory, "new-evaluation.json");
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({ manifestVersion: 1, evaluation: { id: "new" } }),
  );

  try {
    const discoveredPaths = discoverRetainedEvaluationPaths([directory]);
    assert.deepEqual(discoveredPaths, [evidencePath]);
    assert.throws(
      () => readRequiredNodeVersions(discoveredPaths),
      new RegExp(`valid evaluation manifest Node version: ${evidencePath}`),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts matching selector, CI pins, and retained evidence", () => {
  assert.doesNotThrow(() =>
    checkRepositoryNodeVersionContract({
      requiredVersions: ["24.20.0", "24.20.0"],
      selectorVersion: "24.20.0",
      ciVersions: ["24.20.0", "24.20.0"],
    }),
  );
});

test("rejects selector or CI pins that drift from retained evidence", () => {
  assert.throws(
    () =>
      checkRepositoryNodeVersionContract({
        requiredVersions: ["24.20.0", "24.20.0"],
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

test("rejects retained manifests that disagree with each other", () => {
  assert.throws(
    () =>
      checkRepositoryNodeVersionContract({
        requiredVersions: ["24.20.0", "24.19.1"],
        selectorVersion: "24.20.0",
        ciVersions: ["24.20.0"],
      }),
    (error) => {
      assert.match(error.message, /Retained evidence: 24\.20\.0, 24\.19\.1/);
      assert.match(error.message, /every retained manifest/);
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
    assert.deepEqual(
      readAllCiNodeVersions([workflowPath, workflowPath]),
      ["24.20.0", "24.20.0", "24.20.0", "24.20.0"],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});