import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SEVERITIES = ["critical", "high", "moderate", "low", "info"];
const MAX_ADVISORIES = 20;
const MAX_PATHS_PER_ADVISORY = 5;
const MAX_TEXT_LENGTH = 240;
const MAX_AUDIT_OUTPUT_BYTES = 8 * 1024 * 1024;

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
    /\b(?:ERR_PNPM_[A-Z0-9_]+|ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|CERT_[A-Z_]+|SELF_SIGNED_CERT_IN_CHAIN)\b/u,
  )?.[0];
  if (code) return { kind: "registry/network failure", code };
  if (/\b(?:registry|network|fetch|socket|connect|TLS|certificate)\b/iu.test(text)) {
    return { kind: "registry/network failure" };
  }
  return { kind: "audit unavailable" };
}

function readAdvisories(payload) {
  const advisories = payload?.advisories;
  if (Array.isArray(advisories)) return advisories;
  if (advisories && typeof advisories === "object") {
    return Object.values(advisories);
  }
  return null;
}

function normalizeAdvisory(advisory) {
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
  const sourceText = `${stdout}\n${stderr}\n${error?.message ?? ""}`;
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

  const advisories = rawAdvisories.map(normalizeAdvisory);
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

  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const advisory of advisories) counts[advisory.severity] += 1;

  const status = advisories.length > 0 ? "advisories" : "clean";
  return {
    status,
    counts,
    advisories,
    markdown: renderAuditSummary(status, counts, advisories),
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
      for (const { path, version } of uniquePaths.slice(0, MAX_PATHS_PER_ADVISORY)) {
        const versionText = version ? ` (version ${escapeMarkdown(version)})` : "";
        lines.push(`  - Path: ${escapeMarkdown(path)}${versionText}`);
      }
      if (uniquePaths.length > MAX_PATHS_PER_ADVISORY) {
        lines.push(
          `  - ${uniquePaths.length - MAX_PATHS_PER_ADVISORY} additional path(s) omitted.`,
        );
      }
    }
    if (total > MAX_ADVISORIES) {
      lines.push("", `${total - MAX_ADVISORIES} additional advisory record(s) omitted.`);
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
  let result;
  try {
    result = spawnSync("pnpm", ["audit", "--json"], {
      cwd: WORKSPACE_ROOT,
      encoding: "utf8",
      maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
      timeout: 6 * 60 * 1000,
    });
  } catch (error) {
    result = { stdout: "", stderr: "", status: null, error };
  }

  const report = buildWorkspaceAuditReport({
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
  });

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, report.markdown, { encoding: "utf8", mode: 0o600 });
    } catch {
      process.stderr.write(
        "Could not append the full-workspace dependency audit report to the job summary.\n",
      );
      process.stdout.write(report.markdown);
    }
  } else {
    process.stdout.write(report.markdown);
  }

  process.stdout.write(`Workspace audit report status: ${report.status}.\n`);
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runWorkspaceAudit();
}
