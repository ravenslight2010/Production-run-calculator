export interface SourceRecord {
  schemaVersion: 1;
  kind: "prepared-build-source";
  appBuildId: string;
  sourcePolicy: "production-source-v2";
  sourceFingerprintSha256: string;
  gitRevision: string | null;
  gitBinding: "verified" | "unavailable";
  preparedAt: string;
  mode: "publish" | "development";
}
export interface BuildInfo {
  schemaVersion: 1;
  kind: "app-build-info";
  appBuildId: string;
  sourcePolicy: "production-source-v2";
  sourceFingerprintSha256: string;
  gitRevision: string | null;
  gitBinding: "verified" | "unavailable";
  completedAt: string;
  buildMode: "release" | "development";
  platformDeploymentId: string | null;
  platformBuildId: string | null;
  platformIdentitySource: "runtime-reported" | "unavailable";
}
export const PROJECT_ROOT: string;
export const SOURCE_RECORD_PATH: string;
export const EXPECTED_RECORD_PATH: string;
export const INFO_KEYS: readonly string[];
export function validateSourceRecord(input: unknown): SourceRecord;
export function validateBuildInfo(input: unknown): BuildInfo;
export function readBoundedJson(file: string): unknown;
export function writeRecord(file: string, record: unknown): void;
export function createSourceRecord(root: string, mode?: "publish" | "development"): SourceRecord;
export function preparePublishSource(root?: string, options?: { reuse?: boolean }): SourceRecord;
export function buildSourceRecord(root?: string, mode?: "publish" | "development"): SourceRecord;
export function assertSourceUnchanged(root: string, record: SourceRecord): void;
export function sourceRecordDigest(record: SourceRecord): string;
export function buildInfoFromRecord(record: SourceRecord, mode: "release" | "development", completedAt?: string): BuildInfo;
export function completeBuildStage(root: string, record: SourceRecord, stage: "api" | "web"): BuildInfo | false;
export function sealBuildIdentity(root?: string, required?: boolean): BuildInfo | false;