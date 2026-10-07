export type SourceLibraryEvidenceEnvironment = "development" | "release";

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

export type ReadOnlyQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

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
export function parseReport(value: unknown): unknown;
export function isValidSourceLibraryDatabaseOwner(value: unknown): value is string;
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
): Promise<VerificationOutput>;
export function assertBoundedSourceLibraryReconciliationEvidence(
  value: unknown,
): asserts value is VerificationOutput;
