import { caseBasedProductionNeedsAvailable } from "@workspace/inventory-math";

export type StartRunReadiness =
  | { ready: true }
  | { ready: false; missingInput: "pizzasPerCase" };

export function getStartRunReadiness(values: {
  casesNeeded?: number;
  pizzasPerCase?: number;
}): StartRunReadiness {
  return caseBasedProductionNeedsAvailable({
    casesNeeded: Number(values.casesNeeded) || 0,
    pizzasPerCase: Number(values.pizzasPerCase) || 0,
  })
    ? { ready: true }
    : { ready: false, missingInput: "pizzasPerCase" };
}

export function findFirstUnreadyScheduledRun<T extends { id: string; casesNeeded?: number }>(
  runs: readonly T[],
  resolveValues: (run: T) => { pizzasPerCase?: number },
): T | null {
  for (const run of runs) {
    if (!getStartRunReadiness({
      casesNeeded: run.casesNeeded,
      pizzasPerCase: resolveValues(run).pizzasPerCase,
    }).ready) {
      return run;
    }
  }
  return null;
}