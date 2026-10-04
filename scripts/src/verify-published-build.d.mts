import type { SourceRecord } from "./build-source-identity.mjs";
export function verifyPublishedBuild(options: {
  url: string;
  expected: SourceRecord;
  timeoutMs?: number;
}): Promise<{
  appBuildId: string;
  sourcePolicy: string;
  sourceFingerprintSha256: string;
  [key: string]: unknown;
}>;
export function createPublishedSourceHandoff(options: {
  url: string;
  expected: SourceRecord;
  timeoutMs?: number;
}): Promise<Record<string, unknown>>;