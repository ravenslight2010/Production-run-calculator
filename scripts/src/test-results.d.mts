export type StructuredTestCounts = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
};

export type TestResultsLaneCatalog = {
  schemaVersion: number;
  lanes: Array<{ id: string; [key: string]: unknown }>;
};

export type ReleaseStepOutcome = {
  label: string;
  status: string;
  durationMs: number;
  counts?: StructuredTestCounts;
};

export const BROWSER_MAIN_COUNT_SUMMARY_SUFFIX: string;

export function mapReleaseStepOutcomes(
  catalog: TestResultsLaneCatalog,
  outcomes: ReleaseStepOutcome[],
  releaseLaneId: string,
  releaseOutcome: string,
): Array<{ laneId: string; counts: StructuredTestCounts | null }>;

export function readLaneCatalog(path?: string): Promise<TestResultsLaneCatalog>;

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
