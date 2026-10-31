import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatLocalReleaseReport, type LocalReleaseIdentity } from "./local-release-evidence.mts";
import type { ReleaseStepResult } from "./release-check.mts";

const MAX_BYTES = 1024 * 1024;
const MAX_CHECKS = 2000;
const invalid = (): never => { throw new Error("Invalid local report: unsupported, inconsistent, or over budget."); };

type Report = {
  identity: LocalReleaseIdentity;
  full: boolean;
  completed: boolean;
  checks: ReleaseStepResult[];
};

/** Accept only the sanitized local producer contract, not arbitrary Markdown/logs. */
export function parseLocalComparisonReport(text: string): Report {
  if (Buffer.byteLength(text) > MAX_BYTES || text.includes("\r")) invalid();
  const lines = text.split("\n");
  const field = (prefix: string): string => {
    const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length !== 1) return invalid();
    return matches[0]!.slice(prefix.length);
  };
  const identity: LocalReleaseIdentity = {
    revision: field("Assessed revision: "),
    sourceRevision: field("Source revision: "),
    sourcePolicy: field("Source policy: "),
    sourceFingerprintSha256: field("Source fingerprint SHA-256: "),
    verificationFingerprintSha256: field("Verification fingerprint SHA-256: "),
  };
  const mode = field("Check set: ");
  const result = field("Local result: ");
  const captured = field("Captured: ");
  if (!["standard", "full"].includes(mode) || !["PASS", "FAIL", "INCOMPLETE"].includes(result) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(captured) ||
      !Number.isFinite(Date.parse(captured))) invalid();
  const checks: ReleaseStepResult[] = lines.filter((line) => line.startsWith("- ")).map((line) => {
    const match = /^- (PASS|FAIL|INFRASTRUCTURE TIMEOUT|INFRASTRUCTURE ERROR|BLOCKED|NOT REACHED) ([A-Za-z0-9 ()/.:_-]{1,160})$/.exec(line);
    if (!match) return invalid();
    return { status: match[1] as ReleaseStepResult["status"], label: match[2]!, elapsedMs: 0 };
  });
  if (!checks.length || checks.length > MAX_CHECKS) invalid();
  let canonical: string;
  try {
    canonical = formatLocalReleaseReport({
      identity, full: mode === "full", completed: result !== "INCOMPLETE",
      expectedLabels: checks.map((check) => check.label), results: checks,
    }).replace(/^Captured: .*$/m, `Captured: ${captured}`);
  } catch { return invalid(); }
  if (canonical !== text) invalid();
  return { identity, full: mode === "full", completed: result !== "INCOMPLETE", checks };
}

type Category = "newly failing" | "recovered" | "unchanged" | "not comparable";
type Reason = "verification inputs changed" | "incomplete attempt" | "missing before" |
  "missing after" | "non-final status" | "matching verification inputs";

/** Both inputs are validated before any identities are emitted. No current checkout is consulted. */
export function compareLocalReleaseReports(beforeText: string, afterText: string): string {
  const before = parseLocalComparisonReport(beforeText);
  const after = parseLocalComparisonReport(afterText);
  const verificationChanged = before.identity.verificationFingerprintSha256 !== after.identity.verificationFingerprintSha256;
  const previous = new Map(before.checks.map((check) => [check.label, check.status]));
  const current = new Map(after.checks.map((check) => [check.label, check.status]));
  const rows = [...new Set([...previous.keys(), ...current.keys()])].sort().map((label) => {
    const a = previous.get(label);
    const b = current.get(label);
    let category: Category = "not comparable";
    let reason: Reason = "matching verification inputs";
    if (!a) reason = "missing before";
    else if (!b) reason = "missing after";
    else if (verificationChanged) reason = "verification inputs changed";
    else if (!before.completed || !after.completed) reason = "incomplete attempt";
    else if (!["PASS", "FAIL"].includes(a) || !["PASS", "FAIL"].includes(b)) reason = "non-final status";
    else category = a === b ? "unchanged" : b === "PASS" ? "recovered" : "newly failing";
    return { label, before: a ?? "MISSING", after: b ?? "MISSING", category, reason };
  });
  return [
    "# Local Verification Comparison",
    "Scope: local-only; saved reports, not rerun or authenticated evidence",
    "Production decision: NOT ASSESSED",
    "Published readiness: NOT ASSESSED",
    "Production reconciliation: NOT ASSESSED",
    "This comparison cannot issue production GO or change certification outcomes.",
    ...([["Before", before], ["After", after]] as const).flatMap(([name, report]) => [
      `${name} assessed revision: ${report.identity.revision}`,
      `${name} source fingerprint SHA-256: ${report.identity.sourceFingerprintSha256}`,
      `${name} verification fingerprint SHA-256: ${report.identity.verificationFingerprintSha256}`,
      `${name} check set: ${report.full ? "full" : "standard"}`,
      `${name} attempt: ${report.completed ? "completed" : "INCOMPLETE"}`,
    ]),
    `Source changed: ${before.identity.sourceFingerprintSha256 !== after.identity.sourceFingerprintSha256 ? "yes" : "no"}`,
    `Verification inputs changed: ${verificationChanged ? "yes; comparability limited" : "no"}`,
    `Check set changed: ${before.full !== after.full ? "yes; only shared checks can be compared" : "no"}`,
    "Sanitization: validated check identities/statuses and fingerprints only; no paths or raw logs.",
    "",
    ...(["newly failing", "recovered", "unchanged", "not comparable"] as const).flatMap((category) => [
      `## ${category} (${rows.filter((row) => row.category === category).length})`,
      ...rows.filter((row) => row.category === category).map((row) =>
        `- ${row.label}: ${row.before} -> ${row.after} (${row.reason})`),
      "",
    ]),
  ].join("\n");
}

/** No writes, execution, recursive discovery, or unbounded reads; reject symlink files/devices. */
export async function readLocalComparisonInput(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) invalid();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > MAX_BYTES) invalid();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await handle.close(); }
}

export async function runLocalComparison(args: string[]): Promise<void> {
  if (args[0] === "--") args = args.slice(1);
  if (args.length !== 2 || args.some((arg) => arg.startsWith("-"))) {
    throw new Error("Usage: compare:local-release <before-report.md> <after-report.md>");
  }
  const [before, after] = await Promise.all(args.map(readLocalComparisonInput));
  process.stdout.write(compareLocalReleaseReports(before!, after!));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runLocalComparison(process.argv.slice(2)).catch(() => {
    // Never echo input, filesystem errors, paths, stacks, or report contents.
    process.stderr.write("Local comparison failed. Supply two readable, valid local-check reports (at most 1 MiB and 2000 checks each).\n");
    process.exitCode = 1;
  });
}
