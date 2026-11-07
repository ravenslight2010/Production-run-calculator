import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkDeclaredRuntimeInputs,
  checkFrozenWorkflowInstalls,
  checkNodeCompatibilityWorkflow,
  checkRepositoryNodeVersionContract,
  checkRoutineNodeVersion,
  checkWorkspacePackageManagerContract,
  discoverCiWorkflowPaths,
  discoverRetainedEvaluationPaths,
  readAllCiNodeVersions,
  readCiNodeVersions,
  readCurrentEvaluationNodeVersion,
  readNodeSelectorVersion,
  readRequiredNodeVersion,
  readRequiredNodeVersionEntries,
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
        /bash scripts\/src\/run-release-node\.sh pnpm --filter @workspace\/scripts run test/,
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


test("reads the canonical current evaluation manifest version", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const manifestPath = path.join(directory, "evaluation-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      manifestVersion: 1,
      dependencies: { node: "24.22.2" },
    }),
  );

  try {
    assert.equal(readCurrentEvaluationNodeVersion(manifestPath), "24.22.2");
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
    assert.deepEqual(readRequiredNodeVersionEntries(evidencePaths), [
      { evidencePath: evidencePaths[0], requiredVersion: "24.20.0" },
      { evidencePath: evidencePaths[1], requiredVersion: "24.20.0" },
    ]);
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

test("reports retained evidence read failures without exposing filesystem details", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePath = path.join(directory, "evaluation-manifest.json");
  const originalReadFileSync = fs.readFileSync;
  const filesystemDetail = "permission denied: secret mount metadata";
  fs.writeFileSync(evidencePath, "{}");
  fs.readFileSync = (...arguments_) => {
    if (arguments_[0] === evidencePath) {
      const error = new Error(filesystemDetail);
      error.code = "EACCES";
      throw error;
    }
    return originalReadFileSync(...arguments_);
  };

  try {
    assert.throws(
      () => readRequiredNodeVersion(evidencePath),
      (error) => {
        assert.equal(
          error.message,
          `Unable to read retained evaluation evidence: ${evidencePath}`,
        );
        assert.doesNotMatch(error.message, new RegExp(filesystemDetail));
        assert.doesNotMatch(error.message, /EACCES/);
        return true;
      },
    );
    assert.throws(
      () => discoverRetainedEvaluationPaths([directory]),
      (error) => {
        assert.equal(
          error.message,
          `Unable to read retained evaluation evidence: ${evidencePath}`,
        );
        assert.doesNotMatch(error.message, new RegExp(filesystemDetail));
        assert.doesNotMatch(error.message, /EACCES/);
        return true;
      },
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ignores unreadable documentation JSON during retained evidence discovery", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePath = path.join(directory, "evaluation-manifest.json");
  const documentationPath = path.join(directory, "unrelated-documentation.json");
  const originalReadFileSync = fs.readFileSync;
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      manifestVersion: 1,
      dependencies: { node: "24.20.0" },
    }),
  );
  fs.writeFileSync(documentationPath, JSON.stringify({ documentation: true }));
  fs.readFileSync = (...arguments_) => {
    if (arguments_[0] === documentationPath) {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    }
    return originalReadFileSync(...arguments_);
  };

  try {
    assert.deepEqual(discoverRetainedEvaluationPaths([directory]), [
      evidencePath,
    ]);
  } finally {
    fs.readFileSync = originalReadFileSync;
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

test("accepts matching selector, CI pins, and the current manifest", () => {
  assert.doesNotThrow(() =>
    checkRepositoryNodeVersionContract({
      currentVersion: "24.22.2",
      selectorVersion: "24.22.2",
      ciVersions: ["24.22.2", "24.22.2"],
    }),
  );
});

test("rejects selector or CI pins that drift from the current manifest", () => {
  assert.throws(
    () =>
      checkRepositoryNodeVersionContract({
        currentVersion: "24.22.2",
        selectorVersion: "24.22.1",
        ciVersions: ["24.22.2", "24.22.1"],
      }),
    (error) => {
      assert.match(error.message, /Current evaluation manifest: 24\.22\.2/);
      assert.match(error.message, /\.nvmrc selector: 24\.22\.1/);
      assert.match(error.message, /Explicit CI pins: 24\.22\.2, 24\.22\.1/);
      assert.match(error.message, /Preserve dated evidence as historical provenance/);
      return true;
    },
  );
});

test("historical manifest versions remain readable without controlling current pins", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routine-node-"));
  const evidencePaths = ["current.json", "dated.json"].map((name) =>
    path.join(directory, name),
  );
  const contents = [
    JSON.stringify({
      manifestVersion: 1,
      dependencies: { node: "24.22.2" },
    }),
    JSON.stringify({
      manifestVersion: 1,
      dependencies: { node: "24.21.0" },
    }),
  ];
  evidencePaths.forEach((evidencePath, index) => {
    fs.writeFileSync(evidencePath, contents[index]);
  });

  try {
    assert.deepEqual(readRequiredNodeVersions(evidencePaths), [
      "24.22.2",
      "24.21.0",
    ]);
    assert.equal(
      checkRepositoryNodeVersionContract({
        currentVersion: "24.22.2",
        selectorVersion: "24.22.2",
        ciVersions: ["24.22.2"],
      }),
      "24.22.2",
    );
    evidencePaths.forEach((evidencePath, index) => {
      assert.equal(fs.readFileSync(evidencePath, "utf8"), contents[index]);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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

test("resolves CI node-version-file pins from the project selector", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "node-contract-"));
  const workflowPath = path.join(directory, "ci.yml");
  fs.writeFileSync(
    workflowPath,
    [
      "steps:",
      "  - uses: actions/setup-node@pinned",
      "    with:",
      "      node-version-file: .nvmrc",
      "  - uses: actions/setup-node@pinned",
      "    with:",
      "      node-version-file: .nvmrc",
      "",
    ].join("\n"),
  );

  try {
    assert.deepEqual(
      readCiNodeVersions(workflowPath, "24.22.2"),
      ["24.22.2", "24.22.2"],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("requires each CI setup-node step to use exactly one recognized pin", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "node-contract-"));
  const workflowPath = path.join(directory, "ci.yml");
  fs.writeFileSync(
    workflowPath,
    [
      "steps:",
      "  - uses: actions/setup-node@pinned",
      "    with:",
      "      node-version-file: .node-version",
      "",
    ].join("\n"),
  );

  try {
    assert.throws(
      () => readCiNodeVersions(workflowPath, "24.22.2"),
      /CI Node pins must use \.nvmrc/,
    );
    fs.writeFileSync(
      workflowPath,
      [
        "steps:",
        "  - uses: actions/setup-node@pinned",
        "    with:",
        "",
      ].join("\n"),
    );
    assert.throws(
      () => readCiNodeVersions(workflowPath, "24.22.2"),
      /Every actions\/setup-node step must declare exactly one Node pin/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps the separate Node compatibility comparison explicit", () => {
  assert.doesNotThrow(() =>
    checkNodeCompatibilityWorkflow({
      currentVersion: "24.22.2",
      versions: ["24.22.2", "26.10.0"],
    }),
  );
  assert.throws(
    () =>
      checkNodeCompatibilityWorkflow({
        currentVersion: "24.22.2",
        versions: ["24.22.1", "26.10.0"],
      }),
    /must test the pinned project runtime first/,
  );
});

test("checks exact pnpm identity against the lockfile bootstrap", () => {
  const lockfileContents = [
    "  .:",
    "    configDependencies: {}",
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.8.1",
    "        version: 12.8.1",
    "",
  ].join("\n");
  assert.equal(
    checkWorkspacePackageManagerContract({
      packageManager: "pnpm@12.8.1",
      lockfileContents,
    }),
    "12.8.1",
  );
  assert.throws(
    () =>
      checkWorkspacePackageManagerContract({
        packageManager: "pnpm@12.8.2",
        lockfileContents,
      }),
    /package manager version contract is out of sync/,
  );
});

test("checks declared Replit, Nix, Python, and Docker runtime inputs", () => {
  const inputs = {
    nodeVersion: "24.22.2",
    replitConfig: [
      'modules = ["nodejs-24", "python-3.11"]',
      "",
      "[nix]",
      'channel = "stable-25_05"',
    ].join("\n"),
    nixPackageFile: "{pkgs}: {\n  deps = [ pkgs.curl ];\n}\n",
    pyproject: 'requires-python = ">=3.11"\ndependencies = []\n',
    dockerfile: [
      "ARG NODE_IMAGE=node:24.22.2-slim@sha256:" + "a".repeat(64),
      "RUN snapshot=20260824T000000Z \\",
      "",
    ].join("\n"),
  };
  assert.deepEqual(checkDeclaredRuntimeInputs(inputs), {
    nodeVersion: "24.22.2",
    pythonVersion: "3.11",
    nixChannel: "stable-25_05",
  });
  assert.throws(
    () =>
      checkDeclaredRuntimeInputs({
        ...inputs,
        replitConfig: inputs.replitConfig.replace("nodejs-24", "nodejs-22"),
      }),
    /Declared runtime and system dependency inputs are inconsistent/,
  );
});

test("discovers all GitHub workflows except the deliberate compatibility matrix", () => {
  const paths = discoverCiWorkflowPaths();
  assert.ok(paths.length > 0);
  assert.ok(paths.every((workflowPath) => workflowPath.endsWith(".yml") || workflowPath.endsWith(".yaml")));
  assert.ok(
    paths.every(
      (workflowPath) =>
        path.basename(workflowPath) !== "node-compatibility-advisory.yml",
    ),
  );
});

test("requires frozen pnpm installs throughout GitHub workflows", () => {
  assert.doesNotThrow(() => checkFrozenWorkflowInstalls());

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lockfile-"));
  const workflowPath = path.join(directory, "install.yml");
  fs.writeFileSync(
    workflowPath,
    ["steps:", "  - run: pnpm install", ""].join("\n"),
  );
  try {
    assert.throws(
      () => checkFrozenWorkflowInstalls([workflowPath]),
      /CI dependency installs must use the committed pnpm lockfile/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});