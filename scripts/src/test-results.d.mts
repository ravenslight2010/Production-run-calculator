export type StructuredTestCounts = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
};

export const BROWSER_MAIN_COUNT_SUMMARY_SUFFIX: string;

export function parseFullBrowserTestCounts(
  summary: unknown,
  options: {
    expectedRunId: string;
    expectedRevision: string;
    notBeforeMs: number;
    notAfterMs: number;
    expectedCaseCount: number;
    expectedReleaseStatus:
      | "PASS"
      | "FAIL"
      | "INFRASTRUCTURE TIMEOUT"
      | "INFRASTRUCTURE ERROR";
  },
): StructuredTestCounts | null;

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
