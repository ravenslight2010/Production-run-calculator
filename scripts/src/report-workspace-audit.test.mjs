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
  buildWorkspaceAuditDeltaJson,
  buildWorkspaceAuditDeltaReport,
  buildWorkspaceAuditReport,
  buildWorkspaceAuditSnapshot,
  getWorkspaceAuditWarning,
  runWorkspaceAuditWithRetry,
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
    revision: "0123456789abcdef0123456789abcdef01234567",
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
    /\*\*Revision:\*\* `0123456789abcdef0123456789abcdef01234567`/u,
  );
  assert.match(
    report.markdown,
    /critical 0 · high 0 · moderate 0 · low 0 · info 0/u,
  );
  assert.equal(getWorkspaceAuditWarning(report), null);
});

test("reports one attempt for a first-attempt clean audit", () => {
  let attempts = 0;
  const report = runWorkspaceAuditWithRetry({
    executeAudit: () => {
      attempts += 1;
      return { stdout: JSON.stringify(cleanAudit), status: 0 };
    },
    now: () => 0,
  });

  assert.equal(attempts, 1);
  assert.equal(report.attempts, 1);
  assert.equal(report.status, "clean");
  assert.match(report.markdown, /Audit attempts: 1 of 3\./u);
  assert.doesNotMatch(report.markdown, /recovered/u);
});

test("marks missing and malformed audit revisions unavailable without echoing input", () => {
  for (const [name, revision] of [
    ["missing", undefined],
    ["malformed", "sha-from-untrusted-input\n::warning::injected"],
  ]) {
    const report = buildWorkspaceAuditReport({
      stdout: JSON.stringify(cleanAudit),
      exitCode: 0,
      ...(revision === undefined ? {} : { revision }),
    });

    assert.equal(report.status, "clean", name);
    assert.match(report.markdown, /\*\*Revision:\*\* unavailable/u, name);
    assert.doesNotMatch(
      report.markdown,
      /sha-from-untrusted-input|injected/u,
      name,
    );
  }
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
    revision: "a".repeat(64),
  });

  assert.equal(report.status, "advisories");
  assert.equal(report.counts.moderate, 2);
  assert.equal(report.counts.low, 1);
  assert.match(report.markdown, /3 workspace advisory records/u);
  assert.ok(
    report.markdown.includes(`**Revision:** \`${"a".repeat(64)}\``),
  );
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
    revision: "abcdef0123456789abcdef0123456789abcdef01",
  });

  assert.equal(report.status, "unavailable");
  assert.match(report.markdown, /UNAVAILABLE/u);
  assert.match(report.markdown, /registry\/network failure/u);
  assert.match(report.markdown, /ERR_PNPM_FETCH_503/u);
  assert.match(
    report.markdown,
    /\*\*Revision:\*\* `abcdef0123456789abcdef0123456789abcdef01`/u,
  );
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

test("snapshot adds bounded provenance metadata around the existing sanitized summary", () => {
  const report = buildWorkspaceAuditReport({
    stdout: JSON.stringify({
      error: {
        code: "ERR_PNPM_FETCH_503",
        detail:
          "https://user:password@registry.example.invalid/path?token=hidden request-id=private",
      },
    }),
    exitCode: 1,
    revision: "a".repeat(40),
  });
  const originalSha = process.env.GITHUB_SHA;
  const originalActions = process.env.GITHUB_ACTIONS;
  const originalEventName = process.env.GITHUB_EVENT_NAME;
  process.env.GITHUB_SHA = "a".repeat(40);
  process.env.GITHUB_ACTIONS = "true";
  process.env.GITHUB_EVENT_NAME = "workflow_dispatch";

  try {
    const snapshot = buildWorkspaceAuditSnapshot(
      report,
      "2026-11-05T12:00:00.000Z",
    );

    assert.match(snapshot, /Captured at \(UTC\): 2026-11-05T12:00:00\.000Z/u);
    assert.match(snapshot, /Environment: GitHub Actions workflow_dispatch/u);
    assert.match(snapshot, new RegExp(`Revision: ${"a".repeat(40)}`, "u"));
    assert.match(snapshot, /Result: unavailable/u);
    assert.ok(snapshot.endsWith(report.markdown));
    assert.doesNotMatch(
      snapshot,
      /registry\.example\.invalid|user:password|token=hidden|request-id=private/u,
    );
  } finally {
    if (originalSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = originalSha;
    if (originalActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = originalActions;
    if (originalEventName === undefined) delete process.env.GITHUB_EVENT_NAME;
    else process.env.GITHUB_EVENT_NAME = originalEventName;
  }
});

test("retries a structured transient registry failure and returns the recovered audit", () => {
  let attempts = 0;
  let currentTime = 0;
  const delays = [];
  const privateDetails =
    "https://user:password@registry.example.invalid/path?token=do-not-print";
  const report = runWorkspaceAuditWithRetry({
    executeAudit: () => {
      attempts += 1;
      currentTime += 10;
      if (attempts === 1) {
        return {
          stdout: JSON.stringify({
            error: { code: "ETIMEDOUT", detail: privateDetails },
          }),
          status: 1,
        };
      }
      if (attempts === 2) {
        return {
          stdout: JSON.stringify({
            error: {
              code: "ERR_PNPM_FETCH_503",
              detail: privateDetails,
            },
          }),
          status: 1,
        };
      }
      return { stdout: JSON.stringify(cleanAudit), status: 0 };
    },
    sleep: (delay) => {
      delays.push(delay);
      currentTime += delay;
    },
    now: () => currentTime,
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.equal(report.attempts, 3);
  assert.equal(report.status, "clean");
  assert.match(
    report.markdown,
    /Audit attempts: 3 of 3; recovered after a transient registry\/network interruption\./u,
  );
  assert.doesNotMatch(
    report.markdown,
    /registry\.example\.invalid|user:password|do-not-print/u,
  );
  assert.equal(getWorkspaceAuditWarning(report), null);
});

test("preserves advisory status when the audit recovers after a registry failure", () => {
  let attempts = 0;
  const report = runWorkspaceAuditWithRetry({
    executeAudit: () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          stdout: JSON.stringify({ error: { code: "ERR_PNPM_FETCH_503" } }),
          status: 1,
        };
      }
      return {
        stdout: JSON.stringify({
          advisories: [
            {
              module_name: "pkg",
              severity: "low",
              title: "Advisory",
              findings: [{ paths: ["workspace>pkg"] }],
            },
          ],
        }),
        status: 1,
      };
    },
    sleep: () => {},
    now: () => 0,
  });

  assert.equal(report.attempts, 2);
  assert.equal(report.status, "advisories");
  assert.match(report.markdown, /Status: ADVISORIES FOUND/u);
  assert.match(report.markdown, /Audit attempts: 2 of 3; recovered/u);
  assert.equal(getWorkspaceAuditWarning(report), null);
});

test("retries explicit network process errors but not a killed audit process", () => {
  for (const [name, error, signal, expectedAttempts] of [
    ["network reset", { code: "ECONNRESET", message: "socket reset" }, null, 2],
    [
      "audit process timeout",
      { code: "ETIMEDOUT", killed: true, message: "process timed out" },
      "SIGTERM",
      1,
    ],
  ]) {
    let attempts = 0;
    const report = runWorkspaceAuditWithRetry({
      executeAudit: () => {
        attempts += 1;
        if (attempts === 1) {
          return { stdout: "", status: null, error, signal };
        }
        return { stdout: JSON.stringify(cleanAudit), status: 0 };
      },
      sleep: () => {},
      now: () => attempts,
    });

    assert.equal(attempts, expectedAttempts, name);
    assert.equal(
      report.status,
      expectedAttempts === 2 ? "clean" : "unavailable",
      name,
    );
  }
});

test("does not retry clean, advisory, malformed, or non-transient audit results", () => {
  const cases = [
    {
      name: "clean result",
      result: { stdout: JSON.stringify(cleanAudit), status: 0 },
      expectedStatus: "clean",
    },
    {
      name: "advisory result",
      result: {
        stdout: JSON.stringify({
          advisories: [
            {
              module_name: "pkg",
              severity: "low",
              title: "Advisory",
              findings: [{ paths: ["workspace>pkg"] }],
            },
          ],
        }),
        status: 1,
      },
      expectedStatus: "advisories",
    },
    {
      name: "malformed output mentioning a transient code",
      result: {
        stdout: "not json",
        stderr: "ERR_PNPM_FETCH_503",
        status: 1,
      },
      expectedStatus: "unavailable",
    },
    {
      name: "non-transient registry response",
      result: {
        stdout: JSON.stringify({
          error: { code: "ERR_PNPM_FETCH_404" },
        }),
        status: 1,
      },
      expectedStatus: "unavailable",
    },
  ];

  for (const { name, result, expectedStatus } of cases) {
    let attempts = 0;
    const report = runWorkspaceAuditWithRetry({
      executeAudit: () => {
        attempts += 1;
        return result;
      },
      sleep: () => assert.fail(`${name} must not wait for a retry`),
      now: () => 0,
    });

    assert.equal(attempts, 1, name);
    assert.equal(report.status, expectedStatus, name);
  }
});

test("caps transient retries at three attempts and the shared timeout budget", () => {
  let attempts = 0;
  let currentTime = 0;
  const timeouts = [];
  const delays = [];
  const report = runWorkspaceAuditWithRetry({
    executeAudit: (timeout) => {
      attempts += 1;
      timeouts.push(timeout);
      currentTime += timeout;
      return {
        stdout: JSON.stringify({ error: { code: "ERR_PNPM_FETCH_503" } }),
        status: 1,
      };
    },
    sleep: (delay) => {
      delays.push(delay);
      currentTime += delay;
    },
    now: () => currentTime,
  });

  assert.equal(attempts, 3);
  assert.deepEqual(timeouts, [60_000, 60_000, 59_250]);
  assert.deepEqual(delays, [250, 500]);
  assert.equal(currentTime, 180_000);
  assert.equal(report.attempts, 3);
  assert.equal(report.status, "unavailable");
  assert.match(report.markdown, /Audit attempts: 3 of 3\./u);
  assert.match(getWorkspaceAuditWarning(report), /^::warning::/u);
});

test("recovered registry failures appear in the report without warning or blocking CI", () => {
  const testDirectory = mkdtempSync(
    join(tmpdir(), "workspace-audit-recovered-"),
  );
  try {
    const binDirectory = join(testDirectory, "bin");
    const summaryPath = join(testDirectory, "summary.md");
    const callCountPath = join(testDirectory, "pnpm-calls.txt");
    const fakePnpmPath = join(binDirectory, "pnpm");
    const privateDetails =
      "https://user:password@registry.example.invalid/a?token=sensitive";
    const transientFailure = JSON.stringify({
      error: { code: "ERR_PNPM_FETCH_503", detail: privateDetails },
    });

    mkdirSync(binDirectory);
    writeFileSync(
      fakePnpmPath,
      '#!/bin/sh\nprintf \'x\' >> "$FAKE_PNPM_AUDIT_CALLS"\nif [ "$(wc -c < "$FAKE_PNPM_AUDIT_CALLS")" -eq 1 ]; then printf \'%s\\n\' "$FAKE_PNPM_AUDIT_FAILURE"; exit 1; fi\nprintf \'%s\\n\' "$FAKE_PNPM_AUDIT_SUCCESS"\nexit 0\n',
      { mode: 0o700 },
    );

    const result = spawnSync(process.execPath, [reportScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_PNPM_AUDIT_FAILURE: transientFailure,
        FAKE_PNPM_AUDIT_SUCCESS: JSON.stringify(cleanAudit),
        FAKE_PNPM_AUDIT_CALLS: callCountPath,
        GITHUB_ACTIONS: "true",
        GITHUB_STEP_SUMMARY: summaryPath,
        PATH: `${binDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(callCountPath, "utf8"), "xx");
    assert.doesNotMatch(result.stdout, /^::warning::/mu);
    assert.match(
      result.stdout,
      /Workspace audit report status: clean\./u,
    );
    const combinedOutput = `${result.stdout}\n${readFileSync(summaryPath, "utf8")}`;
    assert.match(combinedOutput, /Audit attempts: 2 of 3; recovered/u);
    assert.doesNotMatch(
      combinedOutput,
      /registry\.example\.invalid|user:password|sensitive/u,
    );
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});

test("emits exactly one sanitized GitHub warning for a registry failure", () => {
  const testDirectory = mkdtempSync(join(tmpdir(), "workspace-audit-warning-"));
  try {
    const binDirectory = join(testDirectory, "bin");
    const summaryPath = join(testDirectory, "summary.md");
    const deltaPath = join(testDirectory, "workspace-advisory-delta.json");
    const snapshotPath = join(testDirectory, "workspace-audit-report.md");
    const callCountPath = join(testDirectory, "pnpm-calls.txt");
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
      '#!/bin/sh\nprintf \'x\' >> "$FAKE_PNPM_AUDIT_CALLS"\nprintf \'%s\\n\' "$FAKE_PNPM_AUDIT_RESPONSE"\nexit 1\n',
      { mode: 0o700 },
    );

    const result = spawnSync(process.execPath, [reportScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_PNPM_AUDIT_RESPONSE: auditFailure,
        FAKE_PNPM_AUDIT_CALLS: callCountPath,
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_SHA: "b".repeat(40),
        GITHUB_STEP_SUMMARY: summaryPath,
        WORKSPACE_AUDIT_DELTA_PATH: deltaPath,
        WORKSPACE_AUDIT_REPORT_PATH: snapshotPath,
        WORKSPACE_AUDIT_REVISION: "b".repeat(40),
        PATH: `${binDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(callCountPath, "utf8"), "xxx");
    assert.equal((result.stdout.match(/^::warning::/gmu) ?? []).length, 1);
    assert.match(
      result.stdout,
      /Workspace audit report status: unavailable\./u,
    );
    const combinedOutput = `${result.stdout}\n${readFileSync(summaryPath, "utf8")}`;
    const snapshot = readFileSync(snapshotPath, "utf8");
    assert.doesNotMatch(
      `${combinedOutput}\n${snapshot}`,
      /registry\.example\.invalid|user:password|sensitive|request-id=private|body=secret/u,
    );
    const delta = JSON.parse(readFileSync(deltaPath, "utf8"));
    assert.equal(delta.status, "unavailable");
    assert.deepEqual(delta.counts, {
      introduced: null,
      resolved: null,
      unchanged: null,
      unavailable: 1,
    });
    assert.doesNotMatch(
      readFileSync(deltaPath, "utf8"),
      /registry\.example\.invalid|user:password|sensitive|request-id=private|body=secret/u,
    );
    assert.match(snapshot, /Environment: GitHub Actions workflow_dispatch/u);
    assert.match(snapshot, new RegExp(`Revision: ${"b".repeat(40)}`, "u"));
    assert.match(snapshot, /Result: unavailable/u);
    assert.ok(snapshot.endsWith(readFileSync(summaryPath, "utf8")));
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});

test("snapshot write failures stay report-only and do not fail the audit command", () => {
  const testDirectory = mkdtempSync(
    join(tmpdir(), "workspace-audit-snapshot-failure-"),
  );
  try {
    const binDirectory = join(testDirectory, "bin");
    const missingDirectory = join(testDirectory, "missing");
    const fakePnpmPath = join(binDirectory, "pnpm");
    mkdirSync(binDirectory);
    writeFileSync(
      fakePnpmPath,
      "#!/bin/sh\nprintf '%s\\n' '{\"advisories\":{}}'\n",
      { mode: 0o700 },
    );

    const result = spawnSync(process.execPath, [reportScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        WORKSPACE_AUDIT_REPORT_PATH: join(missingDirectory, "report.md"),
        PATH: `${binDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /Could not write the full-workspace dependency audit snapshot/u,
    );
    assert.match(result.stdout, /Workspace audit report status: clean\./u);
    assert.doesNotMatch(result.stderr, /missing\/report\.md/u);
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});

test("emits one sanitized non-blocking warning for malformed audit output", () => {
  const privateDetails =
    "https://user:password@audit.example.invalid/a?token=sensitive response-body=private";
  const cases = [
    {
      name: "invalid JSON",
      response: `not json ${privateDetails}`,
    },
    {
      name: "unexpected audit shape",
      response: JSON.stringify({
        advisories: "unexpected",
        detail: privateDetails,
      }),
    },
  ];

  for (const { name, response } of cases) {
    const testDirectory = mkdtempSync(
      join(tmpdir(), "workspace-audit-malformed-warning-"),
    );
    try {
      const binDirectory = join(testDirectory, "bin");
      const summaryPath = join(testDirectory, "summary.md");
      const callCountPath = join(testDirectory, "pnpm-calls.txt");
      const fakePnpmPath = join(binDirectory, "pnpm");

      mkdirSync(binDirectory);
      writeFileSync(
        fakePnpmPath,
        '#!/bin/sh\nprintf \'x\' >> "$FAKE_PNPM_AUDIT_CALLS"\nprintf \'%s\\n\' "$FAKE_PNPM_AUDIT_RESPONSE"\nexit 0\n',
        { mode: 0o700 },
      );

      const result = spawnSync(process.execPath, [reportScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_PNPM_AUDIT_RESPONSE: response,
          FAKE_PNPM_AUDIT_CALLS: callCountPath,
          GITHUB_ACTIONS: "true",
          GITHUB_STEP_SUMMARY: summaryPath,
          PATH: `${binDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        },
      });

      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      assert.equal(readFileSync(callCountPath, "utf8"), "x", `${name}: no retry`);
      assert.equal(
        (result.stdout.match(/^::warning::/gmu) ?? []).length,
        1,
        `${name}: exactly one warning`,
      );
      const combinedOutput = `${result.stdout}\n${readFileSync(summaryPath, "utf8")}`;
      assert.match(
        combinedOutput,
        /Workspace audit report status: unavailable\./u,
        `${name}: unavailable status`,
      );
      assert.doesNotMatch(combinedOutput, /Status: CLEAN/u, `${name}: not clean`);
      assert.doesNotMatch(
        combinedOutput,
        /audit\.example\.invalid|user:password|sensitive|response-body=private/u,
        `${name}: private details are redacted`,
      );
    } finally {
      rmSync(testDirectory, { recursive: true, force: true });
    }
  }
});

test("treats malformed output and exit-one empty results as unavailable", () => {
  for (const [input, expectsWarning] of [
    [{ stdout: "not json", stderr: "ECONNRESET", exitCode: 1 }, true],
    [{ stdout: JSON.stringify(cleanAudit), exitCode: 1 }, true],
    [
      { stdout: JSON.stringify({ advisories: "unexpected" }), exitCode: 0 },
      true,
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
  assert.match(getWorkspaceAuditWarning(baseReport), /^::warning::/u);
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

test("exports only stable advisory identities and bounded outcome counts", () => {
  const privateDetails =
    "https://user:password@registry.example.invalid/path?token=do-not-export";
  const baseReport = auditReport({
    "GHSA-gone-1234-efgh": advisory(
      "private-package-name",
      privateDetails,
      [`workspace>${privateDetails}`],
    ),
    "GHSA-stay-1234-efgh": advisory(
      "another-private-package",
      "Original private title",
    ),
  });
  const headReport = auditReport({
    "GHSA-new-1234-efgh": advisory(
      "new-private-package",
      "New private title",
    ),
    "GHSA-stay-1234-efgh": advisory(
      "another-private-package",
      "Updated private title",
    ),
  });
  const delta = buildWorkspaceAuditDeltaReport({ baseReport, headReport });
  const json = buildWorkspaceAuditDeltaJson(delta);
  const parsed = JSON.parse(json);

  assert.deepEqual(
    {
      schemaVersion: parsed.schemaVersion,
      status: parsed.status,
      counts: parsed.counts,
      truncated: parsed.truncated,
      unavailableReason: parsed.unavailableReason,
    },
    {
      schemaVersion: 1,
      status: "compared",
      counts: { introduced: 1, resolved: 1, unchanged: 1, unavailable: 0 },
      truncated: { introduced: 0, resolved: 0, unchanged: 0 },
      unavailableReason: null,
    },
  );
  assert.deepEqual(
    parsed.advisories.map(
      ({ outcome, advisoryId, severity, previousSeverity }) => ({
        outcome,
        advisoryId,
        severity,
        ...(previousSeverity ? { previousSeverity } : {}),
      }),
    ),
    [
      {
        outcome: "introduced",
        advisoryId: "GHSA-NEW-1234-EFGH",
        severity: "moderate",
      },
      {
        outcome: "resolved",
        advisoryId: "GHSA-GONE-1234-EFGH",
        severity: "moderate",
      },
      {
        outcome: "unchanged",
        advisoryId: "GHSA-STAY-1234-EFGH",
        severity: "moderate",
        previousSeverity: "moderate",
      },
    ],
  );
  assert.ok(parsed.advisories.every(({ identity }) =>
    /^sha256:[a-f0-9]{64}$/u.test(identity),
  ));
  assert.doesNotMatch(
    json,
    /private-package|private title|registry\.example\.invalid|password|do-not-export|workspace>/u,
  );
  assert.ok(Buffer.byteLength(json, "utf8") <= 32 * 1024);
});

test("caps exported records while preserving full counts and truncation totals", () => {
  const makeAdvisories = (prefix) =>
    Object.fromEntries(
      Array.from({ length: 23 }, (_, index) => [
        `GHSA-${prefix}${index}-1234-efgh`,
        advisory(`package-${prefix}-${index}`, `Title ${index}`),
      ]),
    );
  const baseReport = auditReport({
    ...makeAdvisories("resolved"),
    ...makeAdvisories("stays"),
  });
  const headReport = auditReport({
    ...makeAdvisories("introduced"),
    ...makeAdvisories("stays"),
  });
  const parsed = JSON.parse(
    buildWorkspaceAuditDeltaJson(
      buildWorkspaceAuditDeltaReport({ baseReport, headReport }),
    ),
  );

  assert.deepEqual(parsed.counts, {
    introduced: 23,
    resolved: 23,
    unchanged: 23,
    unavailable: 0,
  });
  assert.deepEqual(parsed.truncated, {
    introduced: 3,
    resolved: 3,
    unchanged: 3,
  });
  assert.equal(parsed.advisories.length, 60);
  assert.ok(Buffer.byteLength(JSON.stringify(parsed), "utf8") <= 32 * 1024);
});

test("exports unavailable comparisons without failure details or false zero counts", () => {
  const baseReport = buildWorkspaceAuditReport({
    stdout: JSON.stringify({
      error: {
        code: "ERR_PNPM_FETCH_503",
        detail: "https://user:password@private.invalid/?token=secret",
      },
    }),
    exitCode: 1,
  });
  const delta = buildWorkspaceAuditDeltaReport({
    baseReport,
    headReport: auditReport({}),
  });
  const json = buildWorkspaceAuditDeltaJson(delta);
  const parsed = JSON.parse(json);

  assert.equal(parsed.status, "unavailable");
  assert.deepEqual(parsed.counts, {
    introduced: null,
    resolved: null,
    unchanged: null,
    unavailable: 1,
  });
  assert.deepEqual(parsed.advisories, []);
  assert.equal(
    parsed.unavailableReason,
    "base_or_head_audit_unavailable",
  );
  assert.doesNotMatch(json, /ERR_PNPM|private\.invalid|password|secret/u);
});

test("audits only the base lockfile in a credential-isolated temporary project", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "workspace-audit-comparison-test-"),
  );
  try {
    const binDirectory = join(temporaryDirectory, "bin");
    const fixtureDirectory = join(temporaryDirectory, "fixtures");
    const summaryPath = join(temporaryDirectory, "summary.md");
    const deltaPath = join(temporaryDirectory, "workspace-advisory-delta.json");
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

    const auditEnvironment = {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      WORKSPACE_AUDIT_BASE_SHA: "a".repeat(40),
      WORKSPACE_AUDIT_DELTA_PATH: deltaPath,
      WORKSPACE_AUDIT_REVISION: "b".repeat(40),
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
    };
    const result = spawnSync(process.execPath, [reportScript], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: auditEnvironment,
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
    assert.ok(summary.includes(`**Revision:** \`${"b".repeat(40)}\``));
    assert.doesNotMatch(summary, /must-not-reach-base-audit/u);
    const delta = JSON.parse(readFileSync(deltaPath, "utf8"));
    assert.equal(delta.status, "compared");
    assert.deepEqual(delta.counts, {
      introduced: 0,
      resolved: 1,
      unchanged: 0,
      unavailable: 0,
    });
    assert.equal(delta.advisories[0].outcome, "resolved");
    assert.equal(
      delta.advisories[0].advisoryId,
      "GHSA-TEST-1234-ABCD",
    );
    assert.doesNotMatch(
      readFileSync(deltaPath, "utf8"),
      /base-package|Base-only finding|workspace>tool>package/u,
    );

    const privateDetails =
      "https://user:password@audit.example.invalid/a?token=private";
    writeFileSync(
      baseAuditPath,
      JSON.stringify({
        advisories: "unexpected",
        detail: privateDetails,
      }),
    );
    writeFileSync(summaryPath, "");
    auditEnvironment.GITHUB_ACTIONS = "true";
    const malformedBaseResult = spawnSync(process.execPath, [reportScript], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: auditEnvironment,
      timeout: 15_000,
    });

    assert.equal(malformedBaseResult.status, 0, malformedBaseResult.stderr);
    assert.equal(
      (malformedBaseResult.stdout.match(/^::warning::/gmu) ?? []).length,
      1,
    );
    const malformedBaseOutput = `${malformedBaseResult.stdout}\n${readFileSync(summaryPath, "utf8")}`;
    assert.match(
      malformedBaseOutput,
      /Workspace advisory comparison status: unavailable\./u,
    );
    assert.doesNotMatch(malformedBaseOutput, /audit\.example\.invalid|user:password|private/u);
    const unavailableDelta = JSON.parse(readFileSync(deltaPath, "utf8"));
    assert.equal(unavailableDelta.status, "unavailable");
    assert.doesNotMatch(
      readFileSync(deltaPath, "utf8"),
      /audit\.example\.invalid|user:password|private/u,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
