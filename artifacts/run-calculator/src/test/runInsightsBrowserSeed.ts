/** Synthetic E2E setup only; never imported by the application entry point. */
export interface RunInsightsBrowserSeed {
  brand: string;
  flavor: string;
  runId: string;
}

/** Must remain closure-free: Playwright serializes this function into a page. */
export function seedRunInsightsBrowserState({
  brand,
  flavor,
  runId,
}: RunInsightsBrowserSeed): void {
  // addInitScript also runs after reload and inside child frames. Neither may
  // overwrite state that this owned scenario has already saved or recovered.
  if (window.top !== window) return;
  const initializedKey = `e2e-run-insights-seeded:${runId}`;
  if (sessionStorage.getItem(initializedKey) === "1") return;

  localStorage.setItem("run-calc-purge-orphaned-profiles-v1", "1");
  localStorage.setItem("run-calc-day", JSON.stringify({
    runs: [{ id: runId, brand, flavor, seeded: false }],
    currentIndex: 0,
    date: new Date().toISOString().slice(0, 10),
    resetAt: 0,
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
    prepPhase: {
      prepStartedAt: null,
      prepBatchesDough: 0,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
    },
  }));
  localStorage.setItem(`run-calc-run-${runId}`, JSON.stringify({}));
  // Only acknowledge initialization after every required storage write succeeds.
  sessionStorage.setItem(initializedKey, "1");
}
