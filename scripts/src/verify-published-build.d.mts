import type { SourceRecord } from "./build-source-identity.mjs";
export type PublishedSourceMatch = {
  schemaVersion: 1;
  kind: "published-source-match";
  status: "source-match";
  productionGo: false;
  expectedRecordSha256: string;
  appBuildId: string;
  sourcePolicy: string;
  sourceFingerprintSha256: string;
  gitRevision: string | null;
  gitBinding: "verified" | "unavailable";
  builtAt: string;
  capturedAt: string;
  expiresAt: string;
  unresolvedIdentityRequirements: string[];
};
export function verifyPublishedBuild(options: {
  url: string;
  expected: SourceRecord;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PublishedSourceMatch>;
export function createPublishedSourceHandoff(options: {
  url: string;
  expected: SourceRecord;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>>;
export function createPublishedSourceHandoffFromMatch(
  match: PublishedSourceMatch,
  expected: SourceRecord,
): Record<string, unknown>;