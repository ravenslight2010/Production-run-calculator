import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sourceRecordDigest,
  type SourceRecord,
} from "../../../../scripts/src/build-source-identity.mjs";
import {
  verifySourceLibraryReconciliation,
  type VerificationOutput,
} from "../../../../scripts/src/source-library-reconciliation-capture-core.mjs";
import {
  captureSourceLibraryReconciliation,
  captureSourceLibraryReconciliationFromPublishedApp,
  SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES,
  SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES,
  type SourceLibraryCapturePool,
} from "./sourceLibraryReconciliationCapture";

vi.mock(
  "../../../../scripts/src/source-library-reconciliation-capture-core.mjs",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../scripts/src/source-library-reconciliation-capture-core.mjs")
      >();
    return {
      ...actual,
      verifySourceLibraryReconciliation: vi.fn(),
    };
  },
);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const reportBytes = fs.readFileSync(
  path.join(
    repoRoot,
    "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
  ),
);
const reportSha256 = createHash("sha256").update(reportBytes).digest("hex");
const fixedNow = new Date("2026-10-05T17:00:00.000Z");
const expectedSource: SourceRecord = {
  schemaVersion: 1,
  kind: "prepared-build-source",
  appBuildId: "app-build:11111111-1111-4111-8111-111111111111",
  sourcePolicy: "production-source-v2",
  sourceFingerprintSha256: "a".repeat(64),
  gitRevision: null,
  gitBinding: "unavailable",
  preparedAt: "2026-10-05T16:50:00.000Z",
  mode: "publish",
};
const handoff = {
  schemaVersion: 2,
  kind: "published-source-deployment-handoff",
  deploymentId: expectedSource.appBuildId,
  deployedRevision: `source-sha256:${expectedSource.sourceFingerprintSha256}`,
  appBuildId: expectedSource.appBuildId,
  sourcePolicy: expectedSource.sourcePolicy,
  sourceFingerprintSha256: expectedSource.sourceFingerprintSha256,
  identityAuthority: "independent-expected-source-comparison",
  expectedRecordSha256: sourceRecordDigest(expectedSource),
  expectedSource,
  issuedAt: "2026-10-05T16:55:00.000Z",
  expiresAt: "2026-10-05T17:55:00.000Z",
  databaseOwner: "production_owner",
};
const evidenceOutput: VerificationOutput = {
  verifier: "source-library-reconciliation",
  environment: "release",
  databaseAttestation: "external-owner-check",
  revision: handoff.deployedRevision,
  capturedAt: "2026-10-05T17:00:00.000Z",
  evidenceId: "b".repeat(64),
  healId: "source-library-reconciliation-2026-08-26-v2",
  repairBoundary: { fromDate: "2026-08-26" },
  report: {
    sha256: reportSha256,
    formatVersion: 1,
    automaticProposals: 68,
    stubs: 3,
  },
  marker: {
    present: true,
    resultValid: true,
    resultWithinBounds: true,
    resultCounts: {
      replacements: 0,
      aliasesInserted: 0,
      repointedProfiles: 0,
      repointedRuns: 0,
      deletedStubs: 0,
    },
    appliedAtPresent: true,
  },
  pools: {
    expected: 68,
    exactMatches: 68,
    guardedRenames: 0,
    missing: 0,
    mismatches: 0,
  },
  aliases: { expected: 0, exactMatches: 0, missing: 0, mismatches: 0 },
  profiles: { inspected: 0, canonical: 0, stale: 0, nonCanonical: 0 },
  pendingRuns: { inspected: 0, canonical: 0, stale: 0, nonCanonical: 0 },
  protectedHistory: { references: 0 },
  stubs: {
    expected: 3,
    canonicalExact: 3,
    canonicalMissing: 0,
    canonicalMismatches: 0,
    deletedExpected: 3,
    remainingProtected: 0,
    unexpectedlyDeleted: 0,
    unexpectedlyRemaining: 0,
  },
  idempotencyFingerprint: { algorithm: "sha256", value: "c".repeat(64) },
  ok: true,
  failures: [],
};

function fakePool(options: {
  failOnQuery?: string;
  queryGate?: Promise<void>;
  onGatedQuery?: () => void;
  acquireAdvisoryLock?: boolean;
} = {}) {
  const calls: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (text: string) => {
    calls.push(text);
    if (text.includes("pg_try_advisory_lock")) {
      return {
        rows: [{ locked: options.acquireAdvisoryLock ?? true }],
      };
    }
    if (text.includes("pg_advisory_unlock")) {
      return { rows: [{ unlocked: true }] };
    }
    if (options.failOnQuery && text === options.failOnQuery) {
      throw new Error("database detail must not escape");
    }
    if (options.queryGate && text === "SELECT capture_gate") {
      options.onGatedQuery?.();
      await options.queryGate;
    }
    return { rows: [] as Array<Record<string, unknown>> };
  });
  const client = { query, release };
  const pool: SourceLibraryCapturePool = {
    connect: vi.fn(async () => client),
  };
  return { pool, calls, query, release };
}

function dependencies(
  pool: SourceLibraryCapturePool,
  overrides: {
    now?: Date;
    reportBytes?: Buffer;
    reviewedReportSha256?: string;
    sourceFingerprintSha256?: string;
  } = {},
) {
  return {
    pool,
    reportBytes: overrides.reportBytes ?? reportBytes,
    reviewedReportSha256: overrides.reviewedReportSha256 ?? reportSha256,
    buildInfo: {
      appBuildId: expectedSource.appBuildId,
      sourceFingerprintSha256:
        overrides.sourceFingerprintSha256 ??
        expectedSource.sourceFingerprintSha256,
    } as import("../../../../scripts/src/build-source-identity.mjs").BuildInfo,
    now: overrides.now ?? fixedNow,
  };
}

const validRequest = {
  deploymentHandoff: handoff,
  expectedDatabaseOwner: "production_owner",
};

describe("source-library reconciliation capture", () => {
  beforeEach(() => {
    vi.mocked(verifySourceLibraryReconciliation).mockReset();
    vi.mocked(verifySourceLibraryReconciliation).mockImplementation(
      async (_report, _bytes, _healId, query) => {
        await query("SELECT capture_first");
        await query("SELECT capture_second");
        return evidenceOutput;
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses one read-only transaction, bounded local timeouts, and returns summary-only evidence", async () => {
    const fake = fakePool();
    const result = await captureSourceLibraryReconciliation(
      validRequest,
      dependencies(fake.pool),
    );

    expect(fake.calls).toEqual([
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      "BEGIN TRANSACTION READ ONLY",
      "SET LOCAL statement_timeout = '15s'",
      "SET LOCAL lock_timeout = '2s'",
      "SELECT capture_first",
      "SELECT capture_second",
      "ROLLBACK",
      "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
    ]);
    expect(fake.release).toHaveBeenCalledWith(false);
    expect(result).toEqual(evidenceOutput);
    expect(JSON.stringify(result)).not.toContain("production_owner");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
      SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES,
    );
    const call = vi.mocked(verifySourceLibraryReconciliation).mock.calls[0]!;
    expect(call[4]).toBe("2026-08-26");
    expect(call[5]).toBe("release");
    expect(call[6]).toBe(handoff.deployedRevision);
    expect(call[7]).toBe("production_owner");
    expect(call[8]).toBe("external-owner-check");
  });

  it("captures from the published app pool without an external owner name", async () => {
    const runtimeEvidence = {
      ...evidenceOutput,
      databaseAttestation: "published-app-runtime-connection" as const,
    };
    vi.mocked(verifySourceLibraryReconciliation).mockResolvedValue(
      runtimeEvidence,
    );
    const fake = fakePool();
    const result = await captureSourceLibraryReconciliationFromPublishedApp(
      dependencies(fake.pool),
    );

    expect(result).toEqual(runtimeEvidence);
    expect(result.databaseAttestation).toBe(
      "published-app-runtime-connection",
    );
    const call = vi.mocked(verifySourceLibraryReconciliation).mock.calls[0]!;
    expect(call[5]).toBe("release");
    expect(call[6]).toBe(`source-sha256:${expectedSource.sourceFingerprintSha256}`);
    expect(call[7]).toBeUndefined();
    expect(call[8]).toBe("published-app-runtime-connection");
    expect(JSON.stringify(result)).not.toContain("production_owner");
    expect(fake.calls).toContain("BEGIN TRANSACTION READ ONLY");
    expect(fake.calls).toContain("ROLLBACK");
  });

  it("rejects a missing published build identity before connecting", async () => {
    const fake = fakePool();
    await expect(
      captureSourceLibraryReconciliationFromPublishedApp({
        ...dependencies(fake.pool),
        buildInfo: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "build_identity_unavailable",
    });
    expect(fake.pool.connect).not.toHaveBeenCalled();
  });

  it("coordinates capture exclusivity across API processes with a PostgreSQL advisory lock", async () => {
    const fake = fakePool({ acquireAdvisoryLock: false });
    await expect(
      captureSourceLibraryReconciliation(
        validRequest,
        dependencies(fake.pool),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "capture_in_progress",
    });
    expect(fake.calls).toEqual([
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
    ]);
    expect(fake.release).toHaveBeenCalledWith(false);
  });

  it("rejects expired or mismatched deployment identities without acquiring a connection", async () => {
    const expiredPool = fakePool();
    await expect(
      captureSourceLibraryReconciliation(
        {
          ...validRequest,
          deploymentHandoff: {
            ...handoff,
            expiresAt: "2026-10-05T16:59:59.000Z",
          },
        },
        dependencies(expiredPool.pool),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "stale_handoff",
    });

    const mismatchPool = fakePool();
    await expect(
      captureSourceLibraryReconciliation(
        validRequest,
        dependencies(mismatchPool.pool, {
          sourceFingerprintSha256: "d".repeat(64),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "identity_mismatch",
    });
    expect(expiredPool.pool.connect).not.toHaveBeenCalled();
    expect(mismatchPool.pool.connect).not.toHaveBeenCalled();
  });

  it("rejects invalid owner identifiers and report digests before database work", async () => {
    const invalidOwnerPool = fakePool();
    await expect(
      captureSourceLibraryReconciliation(
        { ...validRequest, expectedDatabaseOwner: "production owner" },
        dependencies(invalidOwnerPool.pool),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
    });

    const invalidDigestPool = fakePool();
    await expect(
      captureSourceLibraryReconciliation(
        validRequest,
        dependencies(invalidDigestPool.pool, {
          reviewedReportSha256: "f".repeat(64),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "report_integrity",
    });
    expect(invalidOwnerPool.pool.connect).not.toHaveBeenCalled();
    expect(invalidDigestPool.pool.connect).not.toHaveBeenCalled();
  });

  it("rejects an owner that conflicts with the published handoff", async () => {
    const fake = fakePool();
    await expect(
      captureSourceLibraryReconciliation(
        { ...validRequest, expectedDatabaseOwner: "another_owner" },
        dependencies(fake.pool),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
    });
    expect(fake.pool.connect).not.toHaveBeenCalled();
  });

  it("returns a bounded verifier diagnostic unchanged when ok is false", async () => {
    const diagnostic = {
      ...evidenceOutput,
      ok: false,
      failures: [{ check: "profiles_stale", count: 2 }],
    };
    vi.mocked(verifySourceLibraryReconciliation).mockImplementation(
      async () => diagnostic,
    );
    const fake = fakePool();
    const result = await captureSourceLibraryReconciliation(
      validRequest,
      dependencies(fake.pool),
    );
    expect(result).toEqual(diagnostic);
    expect(result.ok).toBe(false);
    expect(fake.calls.at(-2)).toBe("ROLLBACK");
    expect(fake.calls.at(-1)).toContain("pg_advisory_unlock");
  });

  it("maps database failures to a safe 503 and rolls back before releasing the client", async () => {
    const fake = fakePool({ failOnQuery: "SELECT capture_first" });
    await expect(
      captureSourceLibraryReconciliation(
        validRequest,
        dependencies(fake.pool),
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "database_unavailable",
      publicMessage:
        "The production database could not complete the read-only capture",
    });
    expect(fake.calls).toContain("ROLLBACK");
    expect(fake.release).toHaveBeenCalledWith(false);
  });

  it("allows only one capture per server process", async () => {
    let releaseQuery!: () => void;
    let markQueryEntered!: () => void;
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const queryEntered = new Promise<void>((resolve) => {
      markQueryEntered = resolve;
    });
    const firstFake = fakePool({ queryGate, onGatedQuery: markQueryEntered });
    vi.mocked(verifySourceLibraryReconciliation).mockImplementation(
      async (_report, _bytes, _healId, query) => {
        await query("SELECT capture_gate");
        return evidenceOutput;
      },
    );

    const firstCapture = captureSourceLibraryReconciliation(
      validRequest,
      dependencies(firstFake.pool),
    );
    await queryEntered;
    const secondFake = fakePool();
    await expect(
      captureSourceLibraryReconciliation(
        validRequest,
        dependencies(secondFake.pool),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "capture_in_progress",
    });
    expect(secondFake.pool.connect).not.toHaveBeenCalled();

    releaseQuery();
    await expect(firstCapture).resolves.toEqual(evidenceOutput);
  });

  it("enforces the request-body and verification-output budgets", () => {
    expect(SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES).toBe(8192);
    expect(SOURCE_LIBRARY_CAPTURE_OUTPUT_MAX_BYTES).toBe(32768);
    expect(Buffer.byteLength(JSON.stringify(validRequest), "utf8")).toBeLessThan(
      SOURCE_LIBRARY_CAPTURE_REQUEST_MAX_BYTES,
    );
  });
});
