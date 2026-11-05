import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildWorkspaceAuditDeltaReport,
  buildWorkspaceAuditReport,
  getWorkspaceAuditWarning,
} from "./report-workspace-audit.mjs";

const reportScript = fileURLToPath(
  new URL("./report-workspace-audit.mjs", import.meta.url),
);

const cleanAudit = {
  advisories: {},
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
    },
  },
};

test("reports a valid empty audit as clean with zero severity counts", () => {
  const report = buildWorkspaceAuditReport({
    stdout: JSON.stringify(cleanAudit),
    exitCode: 0,
  });

  assert.equal(report.status, "clean");
  assert.deepEqual(report.counts, {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
  });
  assert.match(report.markdown, /Status: CLEAN/u);
  assert.match(
    report.markdown,
    /critical 0 · high 0 · moderate 0 · low 0 · info 0/u,
  );
  assert.equal(getWorkspaceAuditWarning(report), null);
});

test("reports advisory counts and dependency paths from pnpm JSON", () => {
  const audit = {
    advisories: {
      1: {
        module_name: "glob",
        severity: "moderate",
        title: "Glob advisory",
        findings: [
          {
            version: "11.1.0",
            paths: ["app>build-tool>glob", "scripts>test-tool>glob"],
          },
        ],
      },
      2: {
        module_name: "deepmerge",
        severity: "low",
        title: "Deepmerge advisory",
        findings: [{ version: "4.3.1", paths: ["app>builder>deepmerge"] }],
      },
      3: {
        module_name: "another-package",
        severity: "moderate",
        title: "Another advisory",
        findings: [{ version: "1.0.0", paths: ["lib>another-package"] }],
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0 },
    },
  };

  const report = buildWorkspaceAuditReport({
    stdout: JSON.stringify(audit),
    exitCode: 1,
  });

  assert.equal(report.status, "advisories");
  assert.equal(report.counts.moderate, 2);
  assert.equal(report.counts.low, 1);
  assert.match(report.markdown, /3 workspace advisory records/u);
  assert.match(report.markdown, /app&gt;build\\-tool&gt;glob/u);
  assert.match(report.markdown, /scripts&gt;test\\-tool&gt;glob/u);
  assert.match(report.markdown, /version 11\\\.1\\\.0/u);
  assert.equal(getWorkspaceAuditWarning(report), null);
});

test("bounds the rendered path details and escapes untrusted markdown", () => {
  const advisory = {
    module_name: "pkg`[x]",
    severity: "high",
    title: "Title with <tag> & markup",
    findings: [
      {
        version: "1",
        paths: Array.from(
          { length: 8 },
          (_, index) => `workspace>pkg-${index}`,
        ),
      },
    ],
  };
  const report = buildWorkspaceAuditReport({
    stdout: JSON.stringify({ advisories: [advisory] }),
    exitCode: 1,
  });

  assert.equal(report.status, "advisories");
  assert.match(report.markdown, /pkg\\`\\\[x\\\]/u);
  assert.match(report.markdown, /&lt;tag&gt; &amp; markup/u);
  assert.match(report.markdown, /3 additional path\(s\) omitted/u);
  assert.doesNotMatch(report.markdown, /workspace&gt;pkg-7/u);
});

test("does not report registry errors as a clean audit or expose raw response text", () => {
  const privateRegistryDetail =
    "ERR_PNPM_FETCH_503 https://user:password@registry.example.invalid/path?token=do-not-print request-id=private-request body=private-body";
  const report = buildWorkspaceAuditReport({
    stdout: JSON.stringify({
      error: {
        code: "ERR_PNPM_FETCH_503",
        summary: "Registry request failed",
        detail: privateRegistryDetail,
      },
    }),
    stderr: privateRegistryDetail,
    exitCode: 1,
  });

  assert.equal(report.status, "unavailable");
  assert.match(report.markdown, /UNAVAILABLE/u);
  assert.match(report.markdown, /registry\/network failure/u);
  assert.match(report.markdown, /ERR_PNPM_FETCH_503/u);
  assert.match(report.markdown, /not a clean audit/u);
  assert.doesNotMatch(report.markdown, /registry\.example\.invalid/u);
  assert.doesNotMatch(report.markdown, /do-not-print/u);
  assert.doesNotMatch(
    report.markdown,
    /user:password|private-request|private-body/u,
  );

  const warning = getWorkspaceAuditWarning(report);
  assert.match(warning, /^::warning::/u);
  assert.match(warning, /registry or network could not be reached/u);
  assert.doesNotMatch(warning, /registry\.example\.invalid/u);
  assert.doesNotMatch(warning, /do-not-print/u);
  assert.doesNotMatch(warning, /ERR_PNPM_FETCH_503/u);
  assert.doesNotMatch(warning, /user:password|private-request|private-body/u);
});

test("emits exactly one sanitized GitHub warning for a registry failure", () => {
  const testDirectory = mkdtempSync(join(tmpdir(), "workspace-audit-warning-"));
  try {
    const binDirectory = join(testDirectory, "bin");
    const summaryPath = join(testDirectory, "summary.md");
    const fakePnpmPath = join(binDirectory, "pnpm");
    const privateDetails =
      "https://user:password@registry.example.invalid/a?token=sensitive request-id=private body=secret";
    const auditFailure = JSON.stringify({
      error: {
        code: "ERR_PNPM_FETCH_503",
        detail: privateDetails,
      },
    });

    mkdirSync(binDirectory);
    writeFileSync(
      fakePnpmPath,
      "#!/bin/sh\nprintf '%s\\n' \"$FAKE_PNPM_AUDIT_RESPONSE\"\nexit 1\n",
      { mode: 0o700 },
    );

    const result = spawnSync(process.execPath, [reportScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_PNPM_AUDIT_RESPONSE: auditFailure,
        GITHUB_ACTIONS: "true",
        GITHUB_STEP_SUMMARY: summaryPath,
        PATH: `${binDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout.match(/^::warning::/gmu) ?? []).length, 1);
    assert.match(
      result.stdout,
      /Workspace audit report status: unavailable\./u,
    );
    const combinedOutput = `${result.stdout}\n${readFileSync(summaryPath, "utf8")}`;
    assert.doesNotMatch(
      combinedOutput,
      /registry\.example\.invalid|user:password|sensitive|request-id=private|body=secret/u,
    );
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});

test("treats malformed output and exit-one empty results as unavailable", () => {
  for (const [input, expectsWarning] of [
    [{ stdout: "not json", stderr: "ECONNRESET", exitCode: 1 }, true],
    [{ stdout: JSON.stringify(cleanAudit), exitCode: 1 }, false],
    [
      { stdout: JSON.stringify({ advisories: "unexpected" }), exitCode: 0 },
      false,
    ],
  ]) {
    const report = buildWorkspaceAuditReport(input);
    assert.equal(report.status, "unavailable");
    assert.match(report.markdown, /not a clean audit/u);
    assert.equal(Boolean(getWorkspaceAuditWarning(report)), expectsWarning);
  }
});

function auditReport(advisories) {
  return buildWorkspaceAuditReport({
    stdout: JSON.stringify({ advisories }),
    exitCode: Object.keys(advisories).length > 0 ? 1 : 0,
  });
}

function advisory(moduleName, title, paths = ["workspace>tool>package"]) {
  return {
    module_name: moduleName,
    severity: "moderate",
    title,
    findings: [{ version: "1.0.0", paths }],
  };
}

test("counts the same advisory identity as unchanged across path and title changes", () => {
  const baseReport = auditReport({
    "GHSA-abcd-1234-efgh": advisory("package", "Original advisory"),
  });
  const headReport = auditReport({
    "GHSA-abcd-1234-efgh": advisory("package", "Updated advisory wording", [
      "workspace>new-tool>package",
    ]),
  });

  const delta = buildWorkspaceAuditDeltaReport({ baseReport, headReport });

  assert.equal(delta.status, "compared");
  assert.deepEqual(delta.counts, { introduced: 0, resolved: 0, unchanged: 1 });
  assert.match(delta.markdown, /unchanged 1/u);
});

test("shows severity changes for an advisory that remains the same identity", () => {
  const baseReport = auditReport({
    "GHSA-abcd-1234-efgh": {
      ...advisory("package", "Advisory"),
      severity: "high",
    },
  });
  const headReport = auditReport({
    "GHSA-abcd-1234-efgh": advisory("package", "Advisory"),
  });

  const delta = buildWorkspaceAuditDeltaReport({ baseReport, headReport });

  assert.deepEqual(delta.counts, { introduced: 0, resolved: 0, unchanged: 1 });
  assert.match(delta.markdown, /moderate \(was high\)/u);
});

test("separates introduced, resolved, and unchanged advisory identities", () => {
  const baseReport = auditReport({
    "GHSA-stay-1234-efgh": advisory("kept-package", "Kept finding"),
    "GHSA-gone-1234-efgh": advisory("old-package", "Resolved finding"),
  });
  const headReport = auditReport({
    "GHSA-stay-1234-efgh": advisory("kept-package", "Kept finding"),
    "GHSA-new-1234-efgh": advisory("new-package", "Introduced finding"),
  });

  const delta = buildWorkspaceAuditDeltaReport({ baseReport, headReport });

  assert.equal(delta.status, "compared");
  assert.deepEqual(delta.counts, { introduced: 1, resolved: 1, unchanged: 1 });
  assert.match(delta.markdown, /Introduced finding/u);
  assert.match(delta.markdown, /Resolved finding/u);
});

test("marks malformed base audit output unavailable", () => {
  const baseReport = buildWorkspaceAuditReport({
    stdout: JSON.stringify({ advisories: "not-an-advisory-list" }),
    exitCode: 0,
  });
  const headReport = auditReport({});

  const delta = buildWorkspaceAuditDeltaReport({ baseReport, headReport });

  assert.equal(delta.status, "unavailable");
  assert.match(delta.markdown, /Status: UNAVAILABLE/u);
  assert.match(delta.markdown, /does not affect CI success/u);
});

test("keeps registry failure details out of unavailable comparison output", () => {
  const privateRegistryDetail =
    "ERR_PNPM_FETCH_503 https://registry.example.invalid/path?token=do-not-print";
  const baseReport = buildWorkspaceAuditReport({
    stdout: JSON.stringify({
      error: {
        code: "ERR_PNPM_FETCH_503",
        detail: privateRegistryDetail,
      },
    }),
    stderr: privateRegistryDetail,
    exitCode: 1,
  });
  const headReport = auditReport({});

  const delta = buildWorkspaceAuditDeltaReport({ baseReport, headReport });

  assert.equal(delta.status, "unavailable");
  assert.match(delta.markdown, /Status: UNAVAILABLE/u);
  assert.doesNotMatch(delta.markdown, /registry\.example\.invalid/u);
  assert.doesNotMatch(delta.markdown, /do-not-print/u);
});

test("audits only the base lockfile in a credential-isolated temporary project", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "workspace-audit-comparison-test-"),
  );
  try {
    const binDirectory = join(temporaryDirectory, "bin");
    const fixtureDirectory = join(temporaryDirectory, "fixtures");
    const summaryPath = join(temporaryDirectory, "summary.md");
    const observationPath = join(
      temporaryDirectory,
      "base-audit-observation.json",
    );
    const baseLockfilePath = join(fixtureDirectory, "base-lock.yaml");
    const baseAuditPath = join(fixtureDirectory, "base-audit.json");
    const headAuditPath = join(fixtureDirectory, "head-audit.json");
    const workspaceRoot = resolve(
      fileURLToPath(new URL("../..", import.meta.url)),
    );
    const reportScript = fileURLToPath(
      new URL("./report-workspace-audit.mjs", import.meta.url),
    );
    for (const directory of [binDirectory, fixtureDirectory]) {
      mkdirSync(directory, { recursive: true });
    }

    const baseLockfile = "lockfileVersion: '9.0'\nimporters: {}\n";
    writeFileSync(baseLockfilePath, baseLockfile);
    writeFileSync(
      baseAuditPath,
      JSON.stringify({
        advisories: {
          "GHSA-test-1234-abcd": advisory("base-package", "Base-only finding"),
        },
      }),
    );
    writeFileSync(headAuditPath, JSON.stringify(cleanAudit));
    writeFileSync(
      join(binDirectory, "git"),
      `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
if (process.argv[2] !== "show" || process.argv[3] !== "${"a".repeat(40)}:pnpm-lock.yaml") process.exit(91);
process.stdout.write(readFileSync(process.env.AUDIT_TEST_BASE_LOCKFILE, "utf8"));
`,
    );
    writeFileSync(
      join(binDirectory, "pnpm"),
      `#!/usr/bin/env node
const { readFileSync, readdirSync, writeFileSync } = require("node:fs");
const base = process.cwd() !== process.env.AUDIT_TEST_WORKSPACE_ROOT;
if (base) {
  const details = {
    entries: readdirSync(process.cwd()).sort(),
    homeMatchesProject: process.env.HOME === process.cwd(),
    packageJson: JSON.parse(readFileSync("package.json", "utf8")),
    lockfile: readFileSync("pnpm-lock.yaml", "utf8"),
    registryArg: process.argv.find((arg) => arg.startsWith("--registry=")),
    authFileArg: process.argv.find((arg) => arg.startsWith("--npmrc-auth-file=")),
    credentialEnvKeys: ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GITHUB_TOKEN"].filter((key) => process.env[key]),
    npmConfigKeys: Object.keys(process.env).filter((key) => key.toLowerCase().startsWith("npm_config_")),
  };
  writeFileSync(process.env.AUDIT_TEST_OBSERVATION, JSON.stringify(details));
}
const payloadPath = base ? process.env.AUDIT_TEST_BASE_REPORT : process.env.AUDIT_TEST_HEAD_REPORT;
const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
process.stdout.write(JSON.stringify(payload));
process.exit(Object.keys(payload.advisories ?? {}).length ? 1 : 0);
`,
    );
    for (const executable of ["git", "pnpm"]) {
      chmodSync(join(binDirectory, executable), 0o755);
    }

    const result = spawnSync(process.execPath, [reportScript], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
        WORKSPACE_AUDIT_BASE_SHA: "a".repeat(40),
        GITHUB_STEP_SUMMARY: summaryPath,
        AUDIT_TEST_BASE_LOCKFILE: baseLockfilePath,
        AUDIT_TEST_BASE_REPORT: baseAuditPath,
        AUDIT_TEST_HEAD_REPORT: headAuditPath,
        AUDIT_TEST_OBSERVATION: observationPath,
        AUDIT_TEST_WORKSPACE_ROOT: workspaceRoot,
        NPM_TOKEN: "must-not-reach-base-audit",
        NODE_AUTH_TOKEN: "must-not-reach-base-audit",
        GITHUB_TOKEN: "must-not-reach-base-audit",
        NPM_CONFIG_REGISTRY: "https://private.invalid/",
      },
      timeout: 15_000,
    });

    assert.equal(result.status, 0, result.stderr);
    const observation = JSON.parse(readFileSync(observationPath, "utf8"));
    assert.deepEqual(observation.entries, ["package.json", "pnpm-lock.yaml"]);
    assert.equal(observation.homeMatchesProject, true);
    assert.deepEqual(observation.packageJson, {
      name: "workspace-audit-base-snapshot",
      version: "0.0.0",
      private: true,
    });
    assert.equal(observation.lockfile, baseLockfile);
    assert.equal(
      observation.registryArg,
      "--registry=https://registry.npmjs.org",
    );
    assert.equal(observation.authFileArg, "--npmrc-auth-file=/dev/null");
    assert.deepEqual(observation.credentialEnvKeys, []);
    assert.deepEqual(observation.npmConfigKeys, []);
    const summary = readFileSync(summaryPath, "utf8");
    assert.match(summary, /resolved 1/u);
    assert.doesNotMatch(summary, /must-not-reach-base-audit/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
