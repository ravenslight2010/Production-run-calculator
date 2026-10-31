export interface FreshSourceRecord {
  schemaVersion: 1;
  kind: "prepared-build-source";
  appBuildId: string;
  sourcePolicy: "self-host-fresh-source-v1";
  sourceFingerprintSha256: string;
  gitRevision: string | null;
  gitBinding: "verified" | "unavailable";
  preparedAt: string;
  mode: "self-host-fresh";
}
export interface FreshBuildInfo {
  schemaVersion: 1;
  kind: "app-build-info";
  appBuildId: string;
  sourcePolicy: "self-host-fresh-source-v1";
  sourceFingerprintSha256: string;
  gitRevision: string | null;
  gitBinding: "verified" | "unavailable";
  completedAt: string;
  buildMode: "self-host-fresh";
  platformDeploymentId: null;
  platformBuildId: null;
  platformIdentitySource: "unavailable";
}
export const FRESH_SOURCE_RECORD_PATH: string;
export const FRESH_EXPECTED_RECORD_PATH: string;
export function validateFreshSourceRecord(input: unknown): FreshSourceRecord;
export function validateFreshBuildInfo(input: unknown): FreshBuildInfo;
export function createFreshSourceRecord(root: string): FreshSourceRecord;
export function assertFreshSourceUnchanged(
  root: string,
  record: FreshSourceRecord,
): void;
export function prepareFreshSource(
  root: string,
  options?: { reuse?: boolean },
): FreshSourceRecord;
export function buildFreshSourceRecord(root: string): FreshSourceRecord;
export function freshSourceRecordDigest(record: FreshSourceRecord): string;
export function freshBuildInfoFromRecord(
  record: FreshSourceRecord,
  completedAt?: string,
): FreshBuildInfo;
export function completeFreshBuildStage(
  root: string,
  record: FreshSourceRecord,
  stage: "api" | "web",
): FreshBuildInfo | false;
export function sealFreshBuildIdentity(
  root: string,
  required?: boolean,
): FreshBuildInfo | false;
