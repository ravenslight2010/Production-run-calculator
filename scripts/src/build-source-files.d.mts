export const SOURCE_POLICY: "production-source-v2";

export function isSourceInput(relative: string): boolean;

export interface SourceSnapshot {
  sourcePolicy: typeof SOURCE_POLICY;
  sourceFingerprintSha256: string;
  files: string[];
  gitFilesSha256: Map<string, { mode: string; size: number; sha256: string }>;
}

export function fingerprintSource(root: string): SourceSnapshot;
export function verifiedGitRevision(root: string, snapshot: SourceSnapshot): string | null;
