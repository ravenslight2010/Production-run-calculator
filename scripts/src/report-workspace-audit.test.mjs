import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
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
  assert.match(report.markdown, /critical 0 · high 0 · moderate 0 · low 0 · info 0/u);
  assert.equal(getWorkspaceAuditWarning(report), null);
});

test("reports advisory counts and dependency paths from pnpm JSON", () => {
  const audit = {
    advisories: {
      "1": {
        module_name: "glob",
        severity: "moderate",
        title: "Glob advisory",
        findings: [
          {
            version: "11.1.0",
            paths: [
              "app>build-tool>glob",
              "scripts>test-tool>glob",
            ],
          },
        ],
      },
      "2": {
        module_name: "deepmerge",
        severity: "low",
        title: "Deepmerge advisory",
        findings: [{ version: "4.3.1", paths: ["app>builder>deepmerge"] }],
      },
      "3": {
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
        paths: Array.from({ length: 8 }, (_, index) => `workspace>pkg-${index}`),
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
  assert.doesNotMatch(report.markdown, /user:password|private-request|private-body/u);

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
      '#!/bin/sh\nprintf \'%s\\n\' "$FAKE_PNPM_AUDIT_RESPONSE"\nexit 1\n',
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
    assert.match(result.stdout, /Workspace audit report status: unavailable\./u);
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
    [{ stdout: JSON.stringify({ advisories: "unexpected" }), exitCode: 0 }, false],
  ]) {
    const report = buildWorkspaceAuditReport(input);
    assert.equal(report.status, "unavailable");
    assert.match(report.markdown, /not a clean audit/u);
    assert.equal(Boolean(getWorkspaceAuditWarning(report)), expectsWarning);
  }
});
