export type SourceLibraryEvidenceEnvironment = "development" | "release";

export type SourceLibraryPoolMismatchDescriptor = {
  table: "dough_recipes" | "sauce_recipes" | "cheese_recipes" | "mixes";
  id: string;
  sourceName: string;
  mismatchType: "missing" | "renamed" | "field-mismatch";
  differingFields: string[];
};
export type SourceLibraryPoolMismatchDiagnostics = {
  counts: {
    expected: number;
    exactMatches: number;
    guardedRenames: number;
    missing: number;
    mismatches: number;
  };
  maxItems: number;
  total: number;
  returned: number;
  omitted: number;
  items: SourceLibraryPoolMismatchDescriptor[];
  poolExceptions: {
    id: string | null;
    sha256: string | null;
    approvedMismatches: number;
    unresolvedMismatches: number;
  };
};
export type SourceLibraryPoolExceptionApproval = {
  id: string;
  sha256: string;
  sourceReportSha256: string;
  approvedDifferences: SourceLibraryPoolMismatchDescriptor[];
};
export type ReadOnlyQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export type VerificationOutput = {
  verifier: "source-library-reconciliation";
  environment: SourceLibraryEvidenceEnvironment;
  databaseAttestation?:
    | "external-owner-check"
    | "development-no-owner-check"
    | "published-app-runtime-connection";
  revision: string;
  capturedAt: string;
  evidenceId: string;
  healId: string;
  repairBoundary: { fromDate: string };
  report: {
    sha256: string;
    formatVersion: number;
    automaticProposals: number;
    stubs: number;
  };
  poolExceptions: {
    id: string | null;
    sha256: string | null;
    approvedMismatches: number;
    unresolvedMismatches: number;
  };
  marker: {
    present: boolean;
    resultValid: boolean;
    resultWithinBounds: boolean;
    resultCounts: {
      replacements: number;
      aliasesInserted: number;
      repointedProfiles: number;
      repointedRuns: number;
      deletedStubs: number;
    };
    appliedAtPresent: boolean;
  };
  pools: {
    expected: number;
    exactMatches: number;
    guardedRenames: number;
    missing: number;
    mismatches: number;
  };
  aliases: {
    expected: number;
    exactMatches: number;
    missing: number;
    mismatches: number;
  };
  profiles: {
    inspected: number;
    canonical: number;
    stale: number;
    nonCanonical: number;
  };
  pendingRuns: {
    inspected: number;
    canonical: number;
    stale: number;
    nonCanonical: number;
  };
  protectedHistory: { references: number };
  stubs: {
    expected: number;
    canonicalExact: number;
    canonicalMissing: number;
    canonicalMismatches: number;
    deletedExpected: number;
    remainingProtected: number;
    unexpectedlyDeleted: number;
    unexpectedlyRemaining: number;
  };
  idempotencyFingerprint: { algorithm: "sha256"; value: string };
  ok: boolean;
  failures: Array<{ check: string; count: number }>;
};

export type ReadinessDeploymentHandoff = {
  schemaVersion: 1 | 2;
  kind: "published-deployment-handoff" | "published-source-deployment-handoff";
  deploymentId: string;
  deployedRevision: string;
  databaseOwner?: string;
  issuedAt: string;
  expiresAt: string;
  expectedSource?: unknown;
};

export const DEFAULT_FROM_DATE: string;
export const DEFAULT_HEAL_ID: string;
export const DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS: string;
export const APPROVED_SOURCE_LIBRARY_POOL_EXCEPTION_ID: string;
export const APPROVED_SOURCE_LIBRARY_POOL_EXCEPTIONS_SHA256: string;
export const SOURCE_LIBRARY_POOL_DIAGNOSTIC_MAX_ITEMS: number;
export function parseReport(value: unknown): unknown;
export function isValidSourceLibraryDatabaseOwner(value: unknown): value is string;
export function inspectSourceLibraryPoolMismatchDiagnostics(
  report: unknown,
  query: ReadOnlyQuery,
  poolExceptionApproval?: SourceLibraryPoolExceptionApproval,
  reportBytes?: Buffer,
): Promise<SourceLibraryPoolMismatchDiagnostics>;
export function loadSourceLibraryPoolExceptionApproval(
  exceptionPath: string,
  reportBytes: Buffer,
  evidenceRoot?: string,
): SourceLibraryPoolExceptionApproval;
export function validateReadinessDeploymentHandoff(
  input: Uint8Array | unknown,
  options?: { now?: Date },
): ReadinessDeploymentHandoff;
export function verifySourceLibraryReconciliation(
  report: unknown,
  reportBytes: Buffer,
  healId: string,
  query: ReadOnlyQuery,
  fromDate?: string,
  environment?: SourceLibraryEvidenceEnvironment,
  revision?: string,
  expectedDatabaseOwner?: string,
  databaseAttestation?:
    | "external-owner-check"
    | "development-no-owner-check"
    | "published-app-runtime-connection",
  poolExceptionApproval?: SourceLibraryPoolExceptionApproval,
): Promise<VerificationOutput>;
export function assertBoundedSourceLibraryReconciliationEvidence(
  value: unknown,
): asserts value is VerificationOutput;
