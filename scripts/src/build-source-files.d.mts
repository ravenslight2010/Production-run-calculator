export const SOURCE_POLICY: "production-source-v4";

export const SELF_HOST_FRESH_SOURCE_POLICY: "self-host-fresh-source-v1";
export type SourcePolicy = typeof SOURCE_POLICY | typeof SELF_HOST_FRESH_SOURCE_POLICY;
export function isSourceInput(relative: string, policy?: SourcePolicy): boolean;

export interface SourceSnapshot<Policy extends SourcePolicy = typeof SOURCE_POLICY> {
  sourcePolicy: Policy;
  sourceFingerprintSha256: string;
  files: string[];
  gitFilesSha256: Map<string, { mode: string; size: number; sha256: string }>;
}

export function fingerprintSource(root: string): SourceSnapshot;
export function fingerprintSource(root: string, policy: typeof SOURCE_POLICY): SourceSnapshot;
export function fingerprintSource(root: string, policy: typeof SELF_HOST_FRESH_SOURCE_POLICY): SourceSnapshot<typeof SELF_HOST_FRESH_SOURCE_POLICY>;
export function verifiedGitRevision(root: string, snapshot: SourceSnapshot<SourcePolicy>): string | null;
