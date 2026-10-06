export type StructuredTestCounts = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
};

export function parseStructuredBrowserTestCounts(
  summary: unknown,
  options: {
    expectedRevision: string;
    notBeforeMs: number;
    notAfterMs: number;
    expectedProjects: string[];
    expectedReleaseStatus:
      | "PASS"
      | "FAIL"
      | "INFRASTRUCTURE TIMEOUT"
      | "INFRASTRUCTURE ERROR";
  },
): StructuredTestCounts | null;
