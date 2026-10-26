import type { RunEstimate } from "@workspace/live-calc";

export function RunEstimateBasis({ estimate }: { estimate?: RunEstimate }) {
  if (!estimate) return null;
  return (
    <details className="mt-1 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer min-h-11 py-2">Calculation basis · {estimate.basis}</summary>
      <div className="space-y-1 py-1">
        {estimate.missing.length > 0 && <p>Estimate unavailable: {estimate.missing.join("; ")}.</p>}
        <p>{estimate.cases ?? "?"} cases × {estimate.pizzasPerCase ?? "?"} pizzas/case ÷ {estimate.ppm ?? "?"} pizzas/min.</p>
        <p>{estimate.mode === "crusts" ? "Crust mode uses approximate line speed." : `Dough mode: ${estimate.crustsPerCycle ?? "?"} crusts/cycle × ${estimate.cyclesPerMin ?? "?"} cycles/min × ${estimate.speedAdjustment ?? "?"} adjustment.`} Positive temporary overrides apply.</p>
        <p>Freezer/line transit: {estimate.freezerMin ?? "unknown"} minutes. Planned duration includes one transit window, not an additional setup allowance.</p>
        {(estimate.basis === "live" || estimate.basis === "paused") && (
          <p>{estimate.completedCases ?? "?"} packaged cases recorded. Remaining packaged cases ÷ rate plus {estimate.leadInSec === undefined ? "unknown" : Math.round(estimate.leadInSec / 60 * 10) / 10} min unfilled transit. Paused estimates assume resume now; future pause length is unknown.</p>
        )}
        {estimate.basis === "actual" && <p>Actual start/end timestamps are preserved, even when recipe inputs are incomplete.</p>}
      </div>
    </details>
  );
}
