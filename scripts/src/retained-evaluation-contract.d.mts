export const RETAINED_EVALUATION_DIRECTORY_RELATIVE_PATHS: readonly string[];
export const RETAINED_EVALUATION_MANIFEST_ENVELOPES: readonly string[];
export const RETAINED_EVALUATION_CANONICAL_RELATIVE_PATH: string;

export function retainedEvaluationDirectories(
  repoRoot: string,
): string[];

export function evaluationManifestFromEvidence(
  evidence: unknown,
): unknown;

export function isEvaluationManifestCandidate(
  evidence: unknown,
): boolean;

export function discoverRetainedEvaluationPaths(
  evidenceDirectories: readonly string[],
): string[];