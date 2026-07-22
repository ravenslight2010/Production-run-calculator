import { memo } from "react";
import { useHomeTabCtx } from "../contexts/HomeTabCtx";
import { useLiveRun } from "../contexts/LiveRunContext";
import { fmtTime, fmtComma, runLabel } from "../utils";

// ─── GlanceOverlay ────────────────────────────────────────────────────────────
// Full-screen "at a glance" overlay rendered when showGlance is true.
// Extracted from home.tsx so it can be imported and tested in isolation without
// pulling the full home.tsx dependency tree into the test environment.
//
// Subscription pattern (must not be changed without updating tests):
//   • useHomeTabCtx() — currentRun, runStatus, setShowGlance, v
//   • useLiveRun()    — calc, nowTime, casesFreezerPct
//
// Both subscriptions are intentional: GlanceOverlay floats over the full page
// and stays VISIBLE while manage dialogs are open — it must never freeze.
const GlanceOverlay = memo(function GlanceOverlay() {
  const {
    currentRun, runStatus, setShowGlance, v,
  } = useHomeTabCtx();

  const { calc, nowTime, casesFreezerPct } = useLiveRun();
  const pct = v.casesNeeded > 0 ? Math.min(1, calc.casesCompleted / v.casesNeeded) : 0;
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm p-8 cursor-pointer select-none"
      onClick={() => setShowGlance(false)}
    >
      <div className="text-center space-y-6 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="glance-now" data-now={nowTime.getTime()}>
        {/* Run name */}
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Current Run</p>
          <p className="text-2xl font-bold break-words min-w-0">{runLabel(currentRun)}</p>
        </div>
        {/* Cases */}
        {v.casesNeeded > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Cases</p>
            <p className="text-7xl font-black tabular-nums leading-none" data-testid="glance-cases-completed">{fmtComma(calc.casesCompleted)}</p>
            <p className="text-xl text-muted-foreground mt-1">of {fmtComma(v.casesNeeded)}</p>
            {calc.casesInFreezer > 0 && (
              <p className="text-lg font-semibold text-sky-400 tabular-nums mt-1" data-testid="glance-cases-freezer">+{fmtComma(calc.casesInFreezer)} in freezer</p>
            )}
            {v.casesNeeded > 0 && (
              <div className="mt-3 h-3 rounded-full bg-muted/30 overflow-hidden flex">
                <div className={`h-full transition-all duration-500 ${pct >= 1 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct * 100}%` }} />
                {casesFreezerPct > 0 && (
                  <div className="h-full bg-sky-400/40 transition-all duration-500" style={{ width: `${casesFreezerPct * 100}%` }} />
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Cases Done</p>
            <p className="text-7xl font-black tabular-nums leading-none">{fmtComma(calc.casesCompleted)}</p>
          </div>
        )}
        {/* Time left */}
        {(runStatus === "running" || runStatus === "paused") && calc.adjustedTimeSec > 0 && (
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Time Remaining</p>
            <p className="text-5xl font-black tabular-nums" data-testid="glance-time-remaining">{fmtTime(calc.adjustedTimeSec)}</p>
          </div>
        )}
        {/* Pace + PPM */}
        <div className="flex items-center justify-center gap-4">
          {calc.paceStatus !== null && (
            <span className={`text-base font-bold ${calc.paceStatus === "behind" ? "text-amber-400" : "text-emerald-400"}`}>
              {calc.paceStatus === "on-pace" ? "✓ On Pace" : calc.paceStatus === "ahead" ? `▲ ${calc.paceDelta} ahead` : `▼ ${Math.abs(calc.paceDelta)} behind`}
            </span>
          )}
          {calc.ppm > 0 && <span className="text-base font-bold text-muted-foreground">{calc.ppm} PPM</span>}
        </div>
      </div>
      <p className="absolute bottom-6 text-xs text-muted-foreground/50">Tap anywhere to dismiss</p>
    </div>
  );
});

export default GlanceOverlay;
