import { createHash } from "node:crypto";
import {
  assertBoundedSourceLibraryReconciliationEvidence,
  DEFAULT_FROM_DATE,
  DEFAULT_HEAL_ID,
  isValidSourceLibraryDatabaseOwner,
  parseReport,
  verifySourceLibraryReconciliation,
  type VerificationOutput,
  validateReadinessDeploymentHandoff,
  type ReadinessDeploymentHandoff,
} from "../../../../scripts/src/source-library-reconciliation-capture-core.mjs";
import type { BuildInfo } from "../../../../scripts/src/build-source-identity.mjs";

export const SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES = 8 * 1024;
export const SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES = 32 * 1024;
export const SOURCE_LIBRARY_CAPTURE_STATEMENT_TIMEOUT = "15s";
export const SOURCE_LIBRARY_CAPTURE_LOCK_TIMEOUT = "2s";

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

let captureInProgress = false;

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
  try {
    client = await dependencies.pool.connect();
    transactionOpen = true;
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(
      `SET LOCAL statement_timeout = '${SOURCE_LIBRARY_CAPTURE_STATEMENT_TIMEOUT}'`,
    );
    await client.query(
      `SET LOCAL lock_timeout = '${SOURCE_LIBRARY_CAPTURE_LOCK_TIMEOUT}'`,
    );

    const output = await verifySourceLibraryReconciliation(
      report,
      dependencies.reportBytes,
      DEFAULT_HEAL_ID,
      async (text, values) => {
        const result = await client!.query(text, values ? [...values] : undefined);
        return { rows: result.rows };
      },
      DEFAULT_FROM_DATE,
      "release",
      handoff.deployedRevision,
      input.expectedDatabaseOwner as string,
    );
    try {
      assertBoundedSourceLibraryReconciliationEvidence(output);
    } catch {
      fail(
        500,
        "output_bound",
        "The reconciliation result exceeded its reviewed output contract",
      );
    }
    if (
      Buffer.byteLength(JSON.stringify(output), "utf8") >
      SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES
    ) {
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
    client?.release(destroyClient);
    captureInProgress = false;
  }
}
