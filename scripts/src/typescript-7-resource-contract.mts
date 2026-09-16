export const TYPESCRIPT_7_RESOURCE_BUDGETS = {
  maxElapsedRatio: 1.25,
  maxPeakRssRatio: 1.25,
  maxCandidateElapsedMs: 60_000,
  maxCandidatePeakRssKiB: 1_048_576,
  minimumRevisions: 3,
  requiredModes: ["cold", "warm"] as const,
  approvedForPromotion: true,
} as const;

export const TYPESCRIPT_7_MEASURED_PROJECTS = [
  { name: "scripts", tsconfig: "scripts/tsconfig.json" },
  { name: "api-server", tsconfig: "artifacts/api-server/tsconfig.json" },
  {
    name: "run-calculator",
    tsconfig: "artifacts/run-calculator/tsconfig.json",
  },
  {
    name: "mockup-sandbox",
    tsconfig: "artifacts/mockup-sandbox/tsconfig.json",
  },
  { name: "ai-evaluation", tsconfig: "lib/ai-evaluation/tsconfig.json" },
  { name: "corpus-harness", tsconfig: "lib/corpus-harness/tsconfig.json" },
] as const;

export type Typescript7MeasuredProject = {
  name: string;
  tsconfig: string;
};

export function typescript7MeasuredCheckNames(
  projects: readonly Typescript7MeasuredProject[] = TYPESCRIPT_7_MEASURED_PROJECTS,
): string[] {
  return ["build", ...projects.map((project) => project.name)];
}

export function typescript7ExpectedMeasurementCommandNames(
  projects: readonly Typescript7MeasuredProject[] = TYPESCRIPT_7_MEASURED_PROJECTS,
  modes: readonly string[] = TYPESCRIPT_7_RESOURCE_BUDGETS.requiredModes,
): string[] {
  return modes.flatMap((mode) =>
    typescript7MeasuredCheckNames(projects).flatMap((check) => [
      `typescript-6-${check}-${mode}`,
      `typescript-7-${check}-${mode}`,
    ]),
  );
}

export type Typescript7ResourceBudgets = {
  maxElapsedRatio: number;
  maxPeakRssRatio: number;
  maxCandidateElapsedMs: number;
  maxCandidatePeakRssKiB: number;
  minimumRevisions: number;
  requiredModes: readonly string[];
  approvedForPromotion: boolean;
};

export function typescript7ResourceBudgetsEqual(
  value: unknown,
  expected: Typescript7ResourceBudgets = TYPESCRIPT_7_RESOURCE_BUDGETS,
): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = value as Record<string, unknown>;
  return (
    actual.maxElapsedRatio === expected.maxElapsedRatio &&
    actual.maxPeakRssRatio === expected.maxPeakRssRatio &&
    actual.maxCandidateElapsedMs === expected.maxCandidateElapsedMs &&
    actual.maxCandidatePeakRssKiB === expected.maxCandidatePeakRssKiB &&
    actual.minimumRevisions === expected.minimumRevisions &&
    actual.approvedForPromotion === expected.approvedForPromotion &&
    JSON.stringify(actual.requiredModes) ===
      JSON.stringify(expected.requiredModes)
  );
}

export function classifyTypescript7ResourceRegressions(
  value: unknown,
  comparedChecks: readonly string[],
  resourceBudgets: Typescript7ResourceBudgets = TYPESCRIPT_7_RESOURCE_BUDGETS,
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length !== resourceBudgets.requiredModes.length * comparedChecks.length
  ) {
    return null;
  }
  const expected = new Set(
    resourceBudgets.requiredModes.flatMap((mode) =>
      comparedChecks.map((check) => `${mode}:${check}`),
    ),
  );
  const failures: string[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const item = entry as Record<string, unknown>;
    const key = `${item.mode}:${item.check}`;
    const elapsed = item.elapsedMs as Record<string, unknown> | undefined;
    const memory = item.peakRssKiB as Record<string, unknown> | undefined;
    if (
      !expected.delete(key) ||
      typeof elapsed?.candidate !== "number" ||
      typeof elapsed.ratio !== "number" ||
      typeof memory?.candidate !== "number" ||
      typeof memory.ratio !== "number"
    ) {
      return null;
    }
    if (
      elapsed.ratio > resourceBudgets.maxElapsedRatio ||
      elapsed.candidate > resourceBudgets.maxCandidateElapsedMs
    ) {
      failures.push(`${key}:elapsed`);
    }
    if (
      memory.ratio > resourceBudgets.maxPeakRssRatio ||
      memory.candidate > resourceBudgets.maxCandidatePeakRssKiB
    ) {
      failures.push(`${key}:peak-rss`);
    }
  }
  return expected.size === 0 ? failures : null;
}