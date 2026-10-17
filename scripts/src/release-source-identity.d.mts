export function isSourceRevision(value: unknown): value is string;
export function isAssessmentRevision(value: unknown): value is string;
export function assessmentRevision(policy: string, source: string, verification: string): string;
export function isDeploymentRevision(value: unknown): value is string;
export function isEvidenceRevision(value: unknown): value is string;
export function sourceRevision(fingerprint: string): string;
export function captureReleaseIdentity(root: string): {
  revision: string;
  sourceRevision: string;
  sourcePolicy: string;
  sourceFingerprintSha256: string;
  verificationFingerprintSha256: string;
};