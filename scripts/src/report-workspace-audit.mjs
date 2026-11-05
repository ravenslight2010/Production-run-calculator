import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const WORKSPACE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SEVERITIES = ["critical", "high", "moderate", "low", "info"];
const MAX_ADVISORIES = 20;
const MAX_PATHS_PER_ADVISORY = 5;
const MAX_TEXT_LENGTH = 240;
const MAX_AUDIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_BASE_AUDIT_TIME_MS = 2 * 60 * 1000;
const MAX_AUDIT_ATTEMPTS = 3;
const MAX_AUDIT_TOTAL_MS = 3 * 60 * 1000;
const MAX_AUDIT_ATTEMPT_MS = 60 * 1000;
const AUDIT_RETRY_DELAYS_MS = [250, 500];
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);
const TRANSIENT_PNPM_FETCH_CODES = new Set([
  "ERR_PNPM_FETCH_408",
  "ERR_PNPM_FETCH_429",
  "ERR_PNPM_FETCH_500",
  "ERR_PNPM_FETCH_502",
  "ERR_PNPM_FETCH_503",
  "ERR_PNPM_FETCH_504",
]);
const REGISTRY_UNAVAILABLE_WARNING =
  "::warning::Full-workspace dependency audit is unavailable because the package registry or network could not be reached. The advisory check was not verified; CI remains non-blocking.";

export function getWorkspaceAuditWarning(report) {
  if (
    report?.status === "unavailable" &&
    report.failure?.kind === "registry/network failure"
  ) {
    return REGISTRY_UNAVAILABLE_WARNING;
  }
  return null;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function escapeMarkdown(value) {
  return cleanText(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/([\\`*_{}[\]()#+\-.!|])/gu, "\\$1");
}

function detectRegistryFailure(text) {
  const code = text.match(
    /\b(?:ERR_PNPM_[A-Z0-9_]+|ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|CERT_[A-Z_]+|SELF_SIGNED_CERT_IN_CHAIN)\b/u,
  )?.[0];
  if (code) return { kind: "registry/network failure", code };
  if (
    /\b(?:registry|network|fetch|socket|connect|TLS|certificate)\b/iu.test(text)
  ) {
    return { kind: "registry/network failure" };
  }
  return { kind: "audit unavailable" };
}

function readAdvisories(payload) {
  const advisories = payload?.advisories;
  if (Array.isArray(advisories)) {
    return advisories.map((advisory) => [null, advisory]);
  }
  if (advisories && typeof advisories === "object") {
    return Object.entries(advisories);
  }
  return null;
}

function normalizeAdvisory(advisory, advisoryKey = null) {
  if (
    !advisory ||
    typeof advisory !== "object" ||
    typeof advisory.module_name !== "string" ||
    typeof advisory.title !== "string" ||
    !SEVERITIES.includes(advisory.severity) ||
    !Array.isArray(advisory.findings)
  ) {
    return null;
  }

  const urlIdentifier =
    typeof advisory.url === "string"
      ? advisory.url.match(/\b(?:GHSA-[A-Z0-9-]+|CVE-\d{4}-\d{4,})\b/iu)?.[0]
      : null;
  const identifier = [
    advisory.github_advisory_id,
    advisory.ghsa_id,
    advisory.cve,
    advisory.id,
    urlIdentifier,
    advisoryKey,
  ].find((value) => typeof value === "string" || typeof value === "number");
  const stableIdentifier =
    identifier === undefined || String(identifier).trim() === ""
      ? `fallback:${advisory.severity}:${advisory.title}`
      : `advisory:${String(identifier).trim().toUpperCase()}`;
  const paths = [];
  for (const finding of advisory.findings) {
    if (!finding || typeof finding !== "object") return null;
    const findingPaths = finding.paths;
    if (typeof findingPaths === "string") {
      paths.push({ path: findingPaths, version: finding.version });
    } else if (Array.isArray(findingPaths)) {
      for (const path of findingPaths) {
        if (typeof path !== "string") return null;
        paths.push({ path, version: finding.version });
      }
    } else {
      return null;
    }
  }

  return {
    moduleName: advisory.module_name,
    severity: advisory.severity,
    title: advisory.title,
    identifier: identifier === undefined ? null : String(identifier),
    identity: `${advisory.module_name}\u0000${stableIdentifier}`,
    paths,
  };
}

export function buildWorkspaceAuditReport({
  stdout = "",
  stderr = "",
  exitCode = null,
  signal = null,
  error = null,
}) {
  const sourceText = `${stdout}\n${stderr}\n${error?.code ?? ""}\n${error?.message ?? ""}`;
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    const failure = detectRegistryFailure(sourceText);
    return {
      status: "unavailable",
      failure,
      markdown: renderUnavailable(failure),
    };
  }

  if (payload?.error) {
    const failure = detectRegistryFailure(
      `${sourceText}\n${JSON.stringify(payload.error)}`,
    );
    return {
      status: "unavailable",
      failure,
      markdown: renderUnavailable(failure),
    };
  }

  const rawAdvisories = readAdvisories(payload);
  if (!rawAdvisories) {
    const failure = detectRegistryFailure(sourceText);
    return {
      status: "unavailable",
      failure,
      markdown: renderUnavailable(failure),
    };
  }

  const advisories = rawAdvisories.map(([key, advisory]) =>
    normalizeAdvisory(advisory, key),
  );
  if (advisories.some((advisory) => advisory === null)) {
    const failure = { kind: "audit unavailable" };
    return {
      status: "unavailable",
      failure,
      markdown: renderUnavailable(failure),
    };
  }

  if (signal || error || (exitCode !== 0 && exitCode !== 1)) {
    const failure = detectRegistryFailure(sourceText);
    return {
      status: "unavailable",
      failure,
      markdown: renderUnavailable(failure),
    };
  }

  if (exitCode === 1 && advisories.length === 0) {
    const failure = detectRegistryFailure(sourceText);
    return {
      status: "unavailable",
      failure,
      markdown: renderUnavailable(failure),
    };
  }

  const counts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, 0]),
  );
  for (const advisory of advisories) counts[advisory.severity] += 1;

  const status = advisories.length > 0 ? "advisories" : "clean";
  return {
    status,
    counts,
    advisories,
    markdown: renderAuditSummary(status, counts, advisories),
  };
}

function renderAdvisoryList(title, advisories) {
  const lines = [`### ${title}`];
  if (advisories.length === 0) {
    lines.push("- None.");
    return lines;
  }
  for (const advisory of advisories.slice(0, MAX_ADVISORIES)) {
    const identifier = advisory.identifier
      ? ` — ${escapeMarkdown(advisory.identifier)}`
      : "";
    const previousSeverity =
      advisory.previousSeverity &&
      advisory.previousSeverity !== advisory.severity
        ? ` (was ${escapeMarkdown(advisory.previousSeverity)})`
        : "";
    lines.push(
      `- **${escapeMarkdown(advisory.moduleName)}** (${escapeMarkdown(advisory.severity)}${previousSeverity})${identifier} — ${escapeMarkdown(advisory.title)}`,
    );
  }
  if (advisories.length > MAX_ADVISORIES) {
    lines.push(
      `- ${advisories.length - MAX_ADVISORIES} additional finding(s) omitted.`,
    );
  }
  return lines;
}

export function buildWorkspaceAuditDeltaReport({ baseReport, headReport }) {
  if (
    !baseReport ||
    !headReport ||
    !["clean", "advisories"].includes(baseReport.status) ||
    !["clean", "advisories"].includes(headReport.status)
  ) {
    const unavailableSide =
      baseReport?.status === "unavailable"
        ? "base revision"
        : headReport?.status === "unavailable"
          ? "proposed revision"
          : "base or proposed revision";
    return {
      status: "unavailable",
      markdown: [
        "## Pull-request workspace advisory comparison",
        "",
        `**Status: UNAVAILABLE — the ${unavailableSide} audit could not be verified.**`,
        "",
        "This informational comparison does not affect CI success, the production audit threshold, or release behavior.",
        "",
      ].join("\n"),
    };
  }

  const baseByIdentity = new Map(
    baseReport.advisories.map((advisory) => [advisory.identity, advisory]),
  );
  const headByIdentity = new Map(
    headReport.advisories.map((advisory) => [advisory.identity, advisory]),
  );
  const introduced = headReport.advisories.filter(
    (advisory) => !baseByIdentity.has(advisory.identity),
  );
  const resolved = baseReport.advisories.filter(
    (advisory) => !headByIdentity.has(advisory.identity),
  );
  const unchanged = headReport.advisories
    .filter((advisory) => baseByIdentity.has(advisory.identity))
    .map((advisory) => ({
      ...advisory,
      previousSeverity: baseByIdentity.get(advisory.identity).severity,
    }));
  const counts = {
    introduced: introduced.length,
    resolved: resolved.length,
    unchanged: unchanged.length,
  };
  const markdown = [
    "## Pull-request workspace advisory comparison",
    "",
    `**Status: COMPARED — introduced ${counts.introduced} · resolved ${counts.resolved} · unchanged ${counts.unchanged}.**`,
    "",
    ...renderAdvisoryList("Introduced", introduced),
    "",
    ...renderAdvisoryList("Resolved", resolved),
    "",
    ...renderAdvisoryList("Unchanged", unchanged),
    "",
    "_Informational only; registry or comparison failures do not change CI success, the production audit threshold, or release behavior._",
    "",
  ].join("\n");
  return {
    status: "compared",
    counts,
    introduced,
    resolved,
    unchanged,
    markdown,
  };
}

function renderUnavailable(failure) {
  const reason = failure.code
    ? ` Registry/network error code: \`${failure.code}\`.`
    : "";
  return [
    "## Full-workspace dependency audit (report-only)",
    "",
    `**Status: UNAVAILABLE — ${failure.kind}. This is not a clean audit.**${reason}`,
    "",
    "The full-workspace advisory report could not be verified. The production dependency audit and release gate remain unchanged.",
    "",
  ].join("\n");
}

function renderAuditSummary(status, counts, advisories) {
  const total = advisories.length;
  const statusText =
    status === "clean"
      ? "CLEAN — no known workspace dependency advisories."
      : `ADVISORIES FOUND — ${total} workspace advisory record${total === 1 ? "" : "s"}.`;
  const lines = [
    "## Full-workspace dependency audit (report-only)",
    "",
    `**Status: ${statusText}**`,
    "",
    `Severity counts: ${SEVERITIES.map((severity) => `${severity} ${counts[severity]}`).join(" · ")}.`,
  ];

  if (total > 0) {
    lines.push("", "### Advisory details");
    for (const advisory of advisories.slice(0, MAX_ADVISORIES)) {
      lines.push(
        `- **${escapeMarkdown(advisory.moduleName)}** (${escapeMarkdown(advisory.severity)}) — ${escapeMarkdown(advisory.title)}`,
      );
      const uniquePaths = [
        ...new Map(
          advisory.paths.map(({ path, version }) => [
            `${path}\u0000${version ?? ""}`,
            { path, version },
          ]),
        ).values(),
      ];
      for (const { path, version } of uniquePaths.slice(
        0,
        MAX_PATHS_PER_ADVISORY,
      )) {
        const versionText = version
          ? ` (version ${escapeMarkdown(version)})`
          : "";
        lines.push(`  - Path: ${escapeMarkdown(path)}${versionText}`);
      }
      if (uniquePaths.length > MAX_PATHS_PER_ADVISORY) {
        lines.push(
          `  - ${uniquePaths.length - MAX_PATHS_PER_ADVISORY} additional path(s) omitted.`,
        );
      }
    }
    if (total > MAX_ADVISORIES) {
      lines.push(
        "",
        `${total - MAX_ADVISORIES} additional advisory record(s) omitted.`,
      );
    }
  }

  lines.push(
    "",
    "_Informational only; this report does not change the production audit threshold or release behavior._",
    "",
  );
  return lines.join("\n");
}

export function runWorkspaceAudit() {
  const report = runWorkspaceAuditWithRetry({
    executeAudit: (timeout) => {
      try {
        return spawnSync("pnpm", ["audit", "--json"], {
          cwd: WORKSPACE_ROOT,
          encoding: "utf8",
          maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
          timeout,
        });
      } catch (error) {
        return { stdout: "", stderr: "", status: null, error };
      }
    },
    sleep: sleepSynchronously,
    now: () => performance.now(),
  });

  let markdown = report.markdown;
  const baseSha = process.env.WORKSPACE_AUDIT_BASE_SHA;
  if (baseSha) {
    let baseReport;
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(baseSha)) {
      baseReport = { status: "unavailable" };
    } else {
      let baseLockfile;
      try {
        const baseResult = spawnSync(
          "git",
          ["show", `${baseSha}:pnpm-lock.yaml`],
          {
            cwd: WORKSPACE_ROOT,
            encoding: "utf8",
            maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
            timeout: 15 * 1000,
          },
        );
        if (
          baseResult.status !== 0 ||
          baseResult.error ||
          Buffer.byteLength(baseResult.stdout ?? "", "utf8") === 0
        ) {
          baseReport = { status: "unavailable" };
        } else {
          baseLockfile = baseResult.stdout;
        }
      } catch {
        baseReport = { status: "unavailable" };
      }

      if (baseLockfile !== undefined) {
        baseReport = auditBaseLockfile(baseLockfile);
      }
    }
    const delta = buildWorkspaceAuditDeltaReport({
      baseReport,
      headReport: report,
    });
    markdown += delta.markdown;
    process.stdout.write(
      `Workspace advisory comparison status: ${delta.status}.\n`,
    );
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, markdown, { encoding: "utf8", mode: 0o600 });
    } catch {
      process.stderr.write(
        "Could not append the full-workspace dependency audit report to the job summary.\n",
      );
      process.stdout.write(markdown);
    }
  } else {
    process.stdout.write(markdown);
  }

  const warning = getWorkspaceAuditWarning(report);
  if (warning && process.env.GITHUB_ACTIONS === "true") {
    process.stdout.write(`${warning}\n`);
  }

  process.stdout.write(`Workspace audit report status: ${report.status}.\n`);
  return report;
}

function auditBaseLockfile(lockfile) {
  let temporaryDirectory;
  try {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "workspace-audit-base-"));
    writeFileSync(join(temporaryDirectory, "pnpm-lock.yaml"), lockfile, {
      encoding: "utf8",
      mode: 0o600,
    });
    writeFileSync(
      join(temporaryDirectory, "package.json"),
      JSON.stringify({
        name: "workspace-audit-base-snapshot",
        version: "0.0.0",
        private: true,
      }),
      { encoding: "utf8", mode: 0o600 },
    );

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (
        /^(?:npm_config_|NPM_CONFIG_|NPM_TOKEN$|NODE_AUTH_TOKEN$|GH_TOKEN$|GITHUB_TOKEN$|ACTIONS_ID_TOKEN_REQUEST_)/iu.test(
          key,
        )
      ) {
        delete env[key];
      }
    }
    env.HOME = temporaryDirectory;
    env.XDG_CONFIG_HOME = join(temporaryDirectory, ".config");

    const result = spawnSync(
      "pnpm",
      [
        "--registry=https://registry.npmjs.org",
        "--npmrc-auth-file=/dev/null",
        "audit",
        "--json",
      ],
      {
        cwd: temporaryDirectory,
        encoding: "utf8",
        env,
        maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
        timeout: MAX_BASE_AUDIT_TIME_MS,
      },
    );
    return buildWorkspaceAuditReport({
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status,
      signal: result.signal,
      error: result.error,
    });
  } catch (error) {
    return buildWorkspaceAuditReport({
      stdout: "",
      stderr: "",
      error,
    });
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function sleepSynchronously(delayMs) {
  if (delayMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function getStructuredAuditError(stdout) {
  if (!stdout) return null;
  try {
    const payload = JSON.parse(stdout);
    return payload && typeof payload === "object" && payload.error
      ? payload.error
      : null;
  } catch {
    return null;
  }
}

function isRetryableTransientFailure(report, result) {
  if (
    report?.status !== "unavailable" ||
    report.failure?.kind !== "registry/network failure"
  ) {
    return false;
  }

  if (result.stdout?.trim()) {
    const structuredError = getStructuredAuditError(result.stdout);
    if (!structuredError) return false;

    const code = report.failure.code ?? structuredError.code;
    return (
      TRANSIENT_NETWORK_CODES.has(code) ||
      TRANSIENT_PNPM_FETCH_CODES.has(code)
    );
  }

  return (
    !result.signal &&
    !result.error?.killed &&
    TRANSIENT_NETWORK_CODES.has(result.error?.code)
  );
}

export function runWorkspaceAuditWithRetry({
  executeAudit,
  sleep = sleepSynchronously,
  now = () => performance.now(),
}) {
  const deadline = now() + MAX_AUDIT_TOTAL_MS;
  let report;

  for (let attempt = 0; attempt < MAX_AUDIT_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;

    const timeout = Math.floor(
      Math.min(MAX_AUDIT_ATTEMPT_MS, remainingMs),
    );
    if (timeout <= 0) break;
    let result;
    try {
      result = executeAudit(timeout);
    } catch (error) {
      result = { stdout: "", stderr: "", status: null, error };
    }
    result ??= { stdout: "", stderr: "", status: null };

    report = buildWorkspaceAuditReport({
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status,
      signal: result.signal,
      error: result.error,
    });

    if (
      attempt === MAX_AUDIT_ATTEMPTS - 1 ||
      !isRetryableTransientFailure(report, result)
    ) {
      return report;
    }

    const delayMs = Math.min(
      AUDIT_RETRY_DELAYS_MS[attempt],
      Math.max(0, deadline - now()),
    );
    if (delayMs <= 0) break;
    sleep(delayMs);
  }

  return report ?? buildWorkspaceAuditReport({});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runWorkspaceAudit();
}
