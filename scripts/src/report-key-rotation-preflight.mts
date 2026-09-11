import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const REPORT_KEY_ROTATION_SCAN_LIMIT = 100;
export const REPORT_KEY_ROTATION_PREFLIGHT_VERIFIER =
  "report-key-rotation-preflight";
const REPORT_KEY_ROTATION_DB_ATTEMPTS = 3;

export type ReportSigningKeyring = {
  activeKeyId: string;
  keyIds: string[];
};

export type ReportKeyRotationPreflight = {
  status: "pass" | "blocked";
  canRotate: boolean;
  activeKeyId: string | null;
  storedKeyIds: string[];
  missingKeyIds: string[];
  scan: {
    limit: number;
    checkedDistinctKeyIds: number;
    truncated: boolean;
    complete: boolean;
  };
  failure:
    | "keyring-unavailable"
    | "missing-retained-keys"
    | "audit-truncated"
    | "audit-unavailable"
    | null;
  remediation: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse only the non-secret portion of the configured keyring. Key values are
 * intentionally discarded immediately so diagnostics cannot accidentally
 * include them.
 */
export function parseReportSigningKeyring(
  configured: string | undefined,
): ReportSigningKeyring | null {
  if (!configured?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const activeKeyId = parsed.activeKeyId;
  const keys = parsed.keys;
  if (typeof activeKeyId !== "string" || activeKeyId.trim() === "" || !isRecord(keys)) {
    return null;
  }
  const keyIds: string[] = [];
  for (const [keyId, value] of Object.entries(keys)) {
    if (typeof value !== "string" || value.length < 32) return null;
    keyIds.push(keyId);
  }
  if (!keyIds.includes(activeKeyId)) return null;
  return { activeKeyId, keyIds: keyIds.sort() };
}

export function evaluateReportKeyRotationPreflight(input: {
  keyring: ReportSigningKeyring | null;
  storedKeyIds: readonly string[];
  truncated: boolean;
  limit?: number;
}): ReportKeyRotationPreflight {
  const limit = input.limit ?? REPORT_KEY_ROTATION_SCAN_LIMIT;
  const storedKeyIds = [...input.storedKeyIds];
  const availableKeyIds = input.keyring
    ? new Set(input.keyring.keyIds)
    : new Set<string>();
  const missingKeyIds = storedKeyIds.filter((keyId) => !availableKeyIds.has(keyId));
  const failure = !input.keyring
    ? "keyring-unavailable"
    : input.truncated
      ? "audit-truncated"
      : missingKeyIds.length > 0
        ? "missing-retained-keys"
        : null;
  const remediation = failure === null
    ? null
    : failure === "keyring-unavailable"
      ? "Restore a valid OPERATIONAL_REPORT_SIGNING_KEYS keyring, including the active key and every retained proof key, then rerun this preflight."
      : failure === "missing-retained-keys"
        ? `Restore the retained signing key${missingKeyIds.length === 1 ? "" : "s"} for proof key ID${missingKeyIds.length === 1 ? "" : "s"} ${missingKeyIds.join(", ")} before removing or rotating keys, then rerun this preflight.`
        : "The bounded audit did not inspect every distinct proof key ID. Run a complete audit or reduce historical key-ID churn before rotating keys.";
  return {
    status: failure === null ? "pass" : "blocked",
    canRotate: failure === null,
    activeKeyId: input.keyring?.activeKeyId ?? null,
    storedKeyIds,
    missingKeyIds,
    scan: {
      limit,
      checkedDistinctKeyIds: storedKeyIds.length,
      truncated: input.truncated,
      complete: !input.truncated,
    },
    failure,
    remediation,
  };
}

async function readStoredProofKeyIds(
  database: {
    query: (
      text: string,
      values?: readonly unknown[],
    ) => Promise<{ rows: Array<{ proofKeyId?: unknown }> }>;
  },
): Promise<{
  keyIds: string[];
  truncated: boolean;
}> {
  // The indexed recursive walk bounds work by distinct key ID, not report
  // count. The extra row is evidence that the result is incomplete.
  const result = await database.query(`
    WITH RECURSIVE stored_proof_keys(proof_key_id) AS (
      SELECT min(proof_key_id)
      FROM finalized_operational_reports
      WHERE scope = 'live'
        AND proof_contract = 'hmac-sha256-v1'
        AND proof_key_id IS NOT NULL
      UNION ALL
      SELECT (
        SELECT min(next_report.proof_key_id)
        FROM finalized_operational_reports AS next_report
        WHERE next_report.scope = 'live'
          AND next_report.proof_contract = 'hmac-sha256-v1'
          AND next_report.proof_key_id > stored_proof_keys.proof_key_id
      )
      FROM stored_proof_keys
      WHERE stored_proof_keys.proof_key_id IS NOT NULL
    )
    SELECT proof_key_id AS "proofKeyId"
    FROM stored_proof_keys
    WHERE proof_key_id IS NOT NULL
    LIMIT $1
  `, [REPORT_KEY_ROTATION_SCAN_LIMIT + 1]);
  const rows = result.rows;
  const truncated = rows.length > REPORT_KEY_ROTATION_SCAN_LIMIT;
  return {
    keyIds: rows
      .slice(0, REPORT_KEY_ROTATION_SCAN_LIMIT)
      .map((row) => row.proofKeyId)
      .filter((keyId): keyId is string => typeof keyId === "string"),
    truncated,
  };
}

export async function runReportKeyRotationPreflight(
  configuredKeyring = process.env.OPERATIONAL_REPORT_SIGNING_KEYS,
): Promise<ReportKeyRotationPreflight> {
  const keyring = parseReportSigningKeyring(configuredKeyring);
  if (!keyring) {
    return evaluateReportKeyRotationPreflight({
      keyring: null,
      storedKeyIds: [],
      truncated: false,
    });
  }
  const { pool } = await import("@workspace/db");
  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= REPORT_KEY_ROTATION_DB_ATTEMPTS; attempt += 1) {
      try {
        const stored = await readStoredProofKeyIds(pool);
        return evaluateReportKeyRotationPreflight({
          keyring,
          storedKeyIds: stored.keyIds,
          truncated: stored.truncated,
        });
      } catch (error) {
        lastError = error;
        if (attempt < REPORT_KEY_ROTATION_DB_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    }
    throw lastError;
  } finally {
    await pool.end();
  }
}

function currentRevision(): string {
  const configured = process.env.REPORT_KEY_ROTATION_PREFLIGHT_REVISION;
  const revision = configured ?? execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error("Invalid report-key preflight revision; expected a full Git commit SHA.");
  }
  return revision;
}

async function writeEvidence(
  path: string,
  result: ReportKeyRotationPreflight,
  revision: string | null,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    verifier: REPORT_KEY_ROTATION_PREFLIGHT_VERIFIER,
    environment: process.env.REPORT_KEY_ROTATION_PREFLIGHT_ENVIRONMENT
      ?? process.env.NODE_ENV
      ?? "unknown",
    revision,
    ...result,
  }, null, 2)}\n`, "utf8");
}

export async function main(): Promise<void> {
  const outputPath = process.env.REPORT_KEY_ROTATION_PREFLIGHT_OUTPUT;
  let revision: string | null = null;
  try {
    revision = currentRevision();
    const result = await runReportKeyRotationPreflight();
    if (outputPath) await writeEvidence(outputPath, result, revision);
    console.log(JSON.stringify(result, null, 2));
    if (!result.canRotate) process.exitCode = 1;
  } catch {
    const result = {
      verifier: REPORT_KEY_ROTATION_PREFLIGHT_VERIFIER,
      status: "blocked" as const,
      canRotate: false,
      failure: "audit-unavailable" as const,
      remediation: "The target database could not be audited. Restore database connectivity and rerun this preflight before rotating keys.",
    };
    if (outputPath) {
      await writeEvidence(
        outputPath,
        {
          ...result,
          activeKeyId: null,
          storedKeyIds: [],
          missingKeyIds: [],
          scan: {
            limit: REPORT_KEY_ROTATION_SCAN_LIMIT,
            checkedDistinctKeyIds: 0,
            truncated: false,
            complete: false,
          },
        },
        revision,
      );
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}