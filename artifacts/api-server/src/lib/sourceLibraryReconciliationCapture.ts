import { createHash } from "node:crypto";
import {
  assertBoundedSourceLibraryReconciliationEvidence,
  DEFAULT_FROM_DATE,
  DEFAULT_HEAL_ID,
  isValidSourceLibraryDatabaseOwner,
  inspectSourceLibraryPoolMismatchDiagnostics,
  parseReport,
  SOURCE_LIBRARY_POOL_DIAGNOSTIC_MAX_ITEMS,
  verifySourceLibraryReconciliation,
  type SourceLibraryPoolMismatchDescriptor,
  type SourceLibraryPoolMismatchDiagnostics,
  type ReadOnlyQuery,
  type VerificationOutput,
  validateReadinessDeploymentHandoff,
  type ReadinessDeploymentHandoff,
} from "../../../../scripts/src/source-library-reconciliation-capture-core.mjs";
import type { BuildInfo } from "../../../../scripts/src/build-source-identity.mjs";

export const SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES = 8 * 1024;
export const SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES = 32 * 1024;
export const SOURCE_LIBRARY_CAPTURE_STATEMENT_TIMEOUT = "15s";
export const SOURCE_LIBRARY_CAPTURE_LOCK_TIMEOUT = "2s";
const SOURCE_LIBRARY_CAPTURE_ADVISORY_LOCK_KEY = "6389014719231";

type QueryResult = { rows: Array<Record<string, unknown>> };
type ReadOnlyClient = {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
  release: (destroy?: boolean) => void;
};
export type SourceLibraryCapturePool = {
  connect: () => Promise<ReadOnlyClient>;
};

export class SourceLibraryCaptureFailure extends Error {
  constructor(
    readonly statusCode: 400 | 409 | 500 | 503,
    readonly code:
      | "invalid_request"
      | "stale_handoff"
      | "identity_mismatch"
      | "capture_in_progress"
      | "build_identity_unavailable"
      | "report_integrity"
      | "database_unavailable"
      | "output_bound",
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "SourceLibraryCaptureFailure";
  }
}

type CaptureDependencies = {
  pool: SourceLibraryCapturePool;
  reportBytes: Buffer;
  reviewedReportSha256: string;
  buildInfo: Readonly<BuildInfo> | null;
  now?: Date;
};

export type SourceLibraryDatabaseAttestation =
  | "external-owner-check"
  | "published-app-runtime-connection";

export type SourceLibraryReconciliationDiagnosticsOutput = {
  verifier: "source-library-reconciliation-diagnostics";
  environment: "release";
  databaseAttestation: "published-app-runtime-connection";
  revision: string;
  capturedAt: string;
  report: { sha256: string };
  pools: SourceLibraryPoolMismatchDiagnostics["counts"];
  mismatchDetails: {
    maxItems: number;
    total: number;
    returned: number;
    omitted: number;
    items: SourceLibraryPoolMismatchDescriptor[];
  };
};

let captureInProgress = false;

const POOL_DIAGNOSTIC_FIELDS = new Set([
  "name",
  "components",
  "doughballVariants",
  "doughballWeightOz",
  "doughballsPerTray",
  "brand",
  "flavors",
  "shredderSetting",
  "cellulose",
  "notes",
  "flavor",
  "daysEarly",
]);

function fail(
  statusCode: SourceLibraryCaptureFailure["statusCode"],
  code: SourceLibraryCaptureFailure["code"],
  message: string,
): never {
  throw new SourceLibraryCaptureFailure(statusCode, code, message);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expectedSorted = [...expected].sort();
  return actual.length === expectedSorted.length &&
    actual.every((key, index) => key === expectedSorted[index]);
}

function isBoundedCount(value: unknown, maximum = 68): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum;
}

function validateDiagnosticsOutput(
  value: unknown,
): asserts value is SourceLibraryReconciliationDiagnosticsOutput {
  if (
    !record(value) ||
    !exactKeys(value, [
      "verifier",
      "environment",
      "databaseAttestation",
      "revision",
      "capturedAt",
      "report",
      "pools",
      "mismatchDetails",
    ]) ||
    value.verifier !== "source-library-reconciliation-diagnostics" ||
    value.environment !== "release" ||
    value.databaseAttestation !== "published-app-runtime-connection" ||
    typeof value.revision !== "string" ||
    !/^source-sha256:[a-f0-9]{64}$/u.test(value.revision) ||
    typeof value.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !record(value.report) ||
    !exactKeys(value.report, ["sha256"]) ||
    typeof value.report.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.report.sha256) ||
    !record(value.pools) ||
    !exactKeys(value.pools, [
      "expected",
      "exactMatches",
      "guardedRenames",
      "missing",
      "mismatches",
    ]) ||
    !record(value.mismatchDetails) ||
    !exactKeys(value.mismatchDetails, [
      "maxItems",
      "total",
      "returned",
      "omitted",
      "items",
    ])
  ) {
    throw new Error("Invalid diagnostics output envelope");
  }

  const pools = value.pools;
  const details = value.mismatchDetails;
  if (
    !isBoundedCount(pools.expected) ||
    !isBoundedCount(pools.exactMatches) ||
    !isBoundedCount(pools.guardedRenames) ||
    !isBoundedCount(pools.missing) ||
    !isBoundedCount(pools.mismatches) ||
    pools.exactMatches + pools.guardedRenames + pools.missing + pools.mismatches !==
      pools.expected ||
    details.maxItems !== SOURCE_LIBRARY_POOL_DIAGNOSTIC_MAX_ITEMS ||
    !isBoundedCount(details.total) ||
    !isBoundedCount(details.returned, SOURCE_LIBRARY_POOL_DIAGNOSTIC_MAX_ITEMS) ||
    !isBoundedCount(details.omitted) ||
    details.total !== pools.guardedRenames + pools.missing + pools.mismatches ||
    details.returned + details.omitted !== details.total ||
    !Array.isArray(details.items) ||
    details.items.length !== details.returned
  ) {
    throw new Error("Invalid diagnostics output counts");
  }

  const previous = new Set<string>();
  for (const item of details.items) {
    if (
      !record(item) ||
      !exactKeys(item, [
        "table",
        "id",
        "sourceName",
        "mismatchType",
        "differingFields",
      ]) ||
      !["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"].includes(
        String(item.table),
      ) ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      item.id.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(item.id) ||
      typeof item.sourceName !== "string" ||
      item.sourceName.length === 0 ||
      item.sourceName.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(item.sourceName) ||
      !["missing", "renamed", "field-mismatch"].includes(
        String(item.mismatchType),
      ) ||
      !Array.isArray(item.differingFields) ||
      item.differingFields.length > 8 ||
      item.differingFields.some(
        (field) => typeof field !== "string" || !POOL_DIAGNOSTIC_FIELDS.has(field),
      )
    ) {
      throw new Error("Invalid diagnostics item");
    }
    const key = `${String(item.table)}\u0000${item.id}`;
    if (previous.has(key)) throw new Error("Duplicate diagnostics item");
    previous.add(key);
    if (
      (item.mismatchType === "missing" && item.differingFields.length !== 0) ||
      (item.mismatchType === "renamed" &&
        (item.differingFields.length !== 1 ||
          item.differingFields[0] !== "name")) ||
      (item.mismatchType === "field-mismatch" &&
        (item.differingFields.length === 0 ||
          item.differingFields.includes("name")))
    ) {
      throw new Error("Inconsistent diagnostics item");
    }
  }
}

function publishedBuildRevision(dependencies: CaptureDependencies): string {
  const buildInfo = dependencies.buildInfo;
  if (
    !buildInfo ||
    typeof buildInfo.appBuildId !== "string" ||
    buildInfo.appBuildId.trim() !== buildInfo.appBuildId ||
    buildInfo.appBuildId.length === 0 ||
    buildInfo.appBuildId.length > 128 ||
    !/^[a-f0-9]{64}$/u.test(buildInfo.sourceFingerprintSha256)
  ) {
    fail(
      503,
      "build_identity_unavailable",
      "The running build identity is unavailable",
    );
  }
  return `source-sha256:${buildInfo.sourceFingerprintSha256}`;
}

function validateCaptureIdentity(
  handoffInput: unknown,
  expectedDatabaseOwner: unknown,
  dependencies: CaptureDependencies,
): ReadinessDeploymentHandoff {
  if (
    typeof expectedDatabaseOwner !== "string" ||
    expectedDatabaseOwner.trim() !== expectedDatabaseOwner ||
    !isValidSourceLibraryDatabaseOwner(expectedDatabaseOwner)
  ) {
    fail(400, "invalid_request", "Invalid source-library capture request");
  }

  let serializedHandoff: string | undefined;
  try {
    serializedHandoff = JSON.stringify(handoffInput);
  } catch {
    fail(400, "invalid_request", "Invalid source-library capture request");
  }
  if (
    !serializedHandoff ||
    Buffer.byteLength(serializedHandoff, "utf8") >
      SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES
  ) {
    fail(400, "invalid_request", "Invalid source-library capture request");
  }

  const now = dependencies.now ?? new Date();
  const expiresAt =
    record(handoffInput) && typeof handoffInput.expiresAt === "string"
      ? Date.parse(handoffInput.expiresAt)
      : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
    fail(409, "stale_handoff", "The deployment handoff has expired");
  }

  let handoff: ReadinessDeploymentHandoff;
  try {
    handoff = validateReadinessDeploymentHandoff(
      Buffer.from(serializedHandoff, "utf8"),
      { now },
    );
  } catch {
    fail(400, "invalid_request", "Invalid source-library capture request");
  }

  if (
    handoff.schemaVersion !== 2 ||
    handoff.kind !== "published-source-deployment-handoff"
  ) {
    fail(400, "invalid_request", "A current published source handoff is required");
  }

  if (
    handoff.databaseOwner !== undefined &&
    handoff.databaseOwner !== expectedDatabaseOwner
  ) {
    fail(400, "invalid_request", "Invalid source-library capture request");
  }

  const buildInfo = dependencies.buildInfo;
  if (
    !buildInfo ||
    !buildInfo.appBuildId ||
    !/^[a-f0-9]{64}$/u.test(buildInfo.sourceFingerprintSha256)
  ) {
    fail(
      503,
      "build_identity_unavailable",
      "The running build identity is unavailable",
    );
  }
  if (
    handoff.deploymentId !== buildInfo.appBuildId ||
    handoff.deployedRevision !==
      `source-sha256:${buildInfo.sourceFingerprintSha256}`
  ) {
    fail(
      409,
      "identity_mismatch",
      "The deployment handoff does not match the running build",
    );
  }

  return handoff;
}

function loadReviewedReport(dependencies: CaptureDependencies) {
  const actualSha256 = createHash("sha256")
    .update(dependencies.reportBytes)
    .digest("hex");
  if (
    !/^[a-f0-9]{64}$/u.test(dependencies.reviewedReportSha256) ||
    actualSha256 !== dependencies.reviewedReportSha256
  ) {
    fail(
      500,
      "report_integrity",
      "The bundled source-library report failed its integrity check",
    );
  }
  try {
    return parseReport(
      JSON.parse(dependencies.reportBytes.toString("utf8")) as unknown,
    );
  } catch {
    fail(
      500,
      "report_integrity",
      "The bundled source-library report is invalid",
    );
  }
}

export async function captureSourceLibraryReconciliation(
  input: {
    deploymentHandoff: unknown;
    expectedDatabaseOwner: unknown;
  },
  dependencies: CaptureDependencies,
): Promise<VerificationOutput> {
  const handoff = validateCaptureIdentity(
    input.deploymentHandoff,
    input.expectedDatabaseOwner,
    dependencies,
  );
  const report = loadReviewedReport(dependencies);
  return runReadOnlyCapture(
    report,
    dependencies,
    handoff.deployedRevision,
    input.expectedDatabaseOwner as string,
    "external-owner-check",
  );
}

/**
 * Capture through the published API's own database pool. This proves which
 * database the running app is configured to use; unlike the manager/CLI path,
 * it does not claim an independently supplied PostgreSQL owner-name match.
 */
export async function captureSourceLibraryReconciliationFromPublishedApp(
  dependencies: CaptureDependencies,
): Promise<VerificationOutput> {
  const deployedRevision = publishedBuildRevision(dependencies);
  const report = loadReviewedReport(dependencies);
  return runReadOnlyCapture(
    report,
    dependencies,
    deployedRevision,
    undefined,
    "published-app-runtime-connection",
  );
}

export async function captureSourceLibraryReconciliationDiagnosticsFromPublishedApp(
  dependencies: CaptureDependencies,
): Promise<SourceLibraryReconciliationDiagnosticsOutput> {
  const revision = publishedBuildRevision(dependencies);
  const report = loadReviewedReport(dependencies);
  return runReadOnlyDiagnosticsCapture(report, dependencies, revision);
}

async function runReadOnlyCapture(
  report: ReturnType<typeof loadReviewedReport>,
  dependencies: CaptureDependencies,
  deployedRevision: string,
  expectedDatabaseOwner: string | undefined,
  databaseAttestation: SourceLibraryDatabaseAttestation,
): Promise<VerificationOutput> {
  return withReadOnlyCapture(
    dependencies,
    (query) =>
      verifySourceLibraryReconciliation(
        report,
        dependencies.reportBytes,
        DEFAULT_HEAL_ID,
        query,
        DEFAULT_FROM_DATE,
        "release",
        deployedRevision,
        expectedDatabaseOwner,
        databaseAttestation,
      ),
    (output) => {
      assertBoundedSourceLibraryReconciliationEvidence(output);
      if (output.databaseAttestation !== databaseAttestation) {
        throw new Error("Capture attestation did not match the requested mode");
      }
    },
  );
}

async function runReadOnlyDiagnosticsCapture(
  report: ReturnType<typeof loadReviewedReport>,
  dependencies: CaptureDependencies,
  deployedRevision: string,
): Promise<SourceLibraryReconciliationDiagnosticsOutput> {
  return withReadOnlyCapture<SourceLibraryReconciliationDiagnosticsOutput>(
    dependencies,
    async (query) => {
      const poolDiagnostics =
        await inspectSourceLibraryPoolMismatchDiagnostics(report, query);
      return {
        verifier: "source-library-reconciliation-diagnostics",
        environment: "release",
        databaseAttestation: "published-app-runtime-connection",
        revision: deployedRevision,
        capturedAt: (dependencies.now ?? new Date()).toISOString(),
        report: {
          sha256: createHash("sha256")
            .update(dependencies.reportBytes)
            .digest("hex"),
        },
        pools: poolDiagnostics.counts,
        mismatchDetails: {
          maxItems: poolDiagnostics.maxItems,
          total: poolDiagnostics.total,
          returned: poolDiagnostics.returned,
          omitted: poolDiagnostics.omitted,
          items: poolDiagnostics.items,
        },
      };
    },
    validateDiagnosticsOutput,
  );
}

async function withReadOnlyCapture<T>(
  dependencies: CaptureDependencies,
  operation: (query: ReadOnlyQuery) => Promise<T>,
  validateOutput: (output: T) => void,
): Promise<T> {
  if (captureInProgress) {
    fail(
      409,
      "capture_in_progress",
      "A source-library capture is already running",
    );
  }
  captureInProgress = true;

  let client: ReadOnlyClient | undefined;
  let transactionOpen = false;
  let destroyClient = false;
  let advisoryLockHeld = false;
  try {
    client = await dependencies.pool.connect();
    let lockResult;
    try {
      lockResult = await client.query(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [SOURCE_LIBRARY_CAPTURE_ADVISORY_LOCK_KEY],
      );
    } catch (error) {
      destroyClient = true;
      throw error;
    }
    advisoryLockHeld = lockResult.rows[0]?.locked === true;
    if (!advisoryLockHeld) {
      fail(
        409,
        "capture_in_progress",
        "A source-library capture is already running",
      );
    }
    transactionOpen = true;
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(
      `SET LOCAL statement_timeout = '${SOURCE_LIBRARY_CAPTURE_STATEMENT_TIMEOUT}'`,
    );
    await client.query(
      `SET LOCAL lock_timeout = '${SOURCE_LIBRARY_CAPTURE_LOCK_TIMEOUT}'`,
    );

    const query: ReadOnlyQuery = async (text, values) => {
        const result = await client!.query(text, values ? [...values] : undefined);
        return { rows: result.rows };
    };
    const output = await operation(query);
    try {
      validateOutput(output);
    } catch {
      fail(
        500,
        "output_bound",
        "The reconciliation result exceeded its reviewed output contract",
      );
    }
    let serializedOutput: string;
    try {
      serializedOutput = JSON.stringify(output);
    } catch {
      fail(
        500,
        "output_bound",
        "The reconciliation result exceeded its reviewed output contract",
      );
    }
    if (Buffer.byteLength(serializedOutput, "utf8") > SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES) {
      fail(
        500,
        "output_bound",
        "The reconciliation result exceeded its reviewed output contract",
      );
    }

    await client.query("ROLLBACK");
    transactionOpen = false;
    return output;
  } catch (error) {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch {
        destroyClient = true;
      }
    }
    if (error instanceof SourceLibraryCaptureFailure) throw error;
    throw new SourceLibraryCaptureFailure(
      503,
      "database_unavailable",
      "The production database could not complete the read-only capture",
    );
  } finally {
    if (advisoryLockHeld && client) {
      try {
        const unlockResult = await client.query(
          "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
          [SOURCE_LIBRARY_CAPTURE_ADVISORY_LOCK_KEY],
        );
        if (unlockResult.rows[0]?.unlocked !== true) {
          destroyClient = true;
        }
      } catch {
        destroyClient = true;
      }
    }
    client?.release(destroyClient);
    captureInProgress = false;
  }
}
