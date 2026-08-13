import { memo } from "react";
import { Pause, Play, ChevronRight, Timer } from "lucide-react";
import { useHomeTabCtx } from "../contexts/HomeTabCtx";
import { useLiveRun } from "../contexts/LiveRunContext";
import { fmtElapsed, fmtComma, fmtClock, fmtCountdownParts } from "../utils";
import { computeLinePhases, pickMostActivePhase, type PhaseInfo } from "../linePhases";
import { PRE_POST_TUNNEL_DEFAULT_MIN } from "../types";

// ─── CompactRunStrip ──────────────────────────────────────────────────────────
// Condensed run-summary header shown on every tab except the Run tab.
// Extracted from home.tsx so it can be imported and tested in isolation without
// pulling the full home.tsx dependency tree into the test environment.
//
// Subscription pattern (must not be changed without updating tests):
//   • useHomeTabCtx() — runStatus, currentRun, dayState, v, ve, setActiveTab, pauseRun
//   • useLiveRun()    — calc, nowTime, elapsedBatchSec, casesPct, casesFreezerPct
//
// Both subscriptions are intentional: this strip floats persistently in the
// header and stays VISIBLE while manage dialogs are open — it must never freeze.

// Local presentational helper — avoids a circular import with home.tsx.
// The authoritative exported copy and its tests live in home.tsx
// (elapsedTimeCap.render.test.tsx). This copy must stay logic-identical.
function ElapsedTimeBadge({
  nowMs,
  startedAt,
  pausedAt,
  "data-testid": testId,
  className,
}: {
  nowMs: number;
  startedAt: number;
  pausedAt?: number | null;
  "data-testid"?: string;
  className?: string;
}) {
  const runAge = nowMs - startedAt;
  const addend = pausedAt != null
    ? Math.min(runAge, Math.max(0, nowMs - pausedAt))
    : 0;
  return <span data-testid={testId} className={className}>{fmtElapsed(runAge + addend)}</span>;
}

const CompactRunStrip = memo(function CompactRunStrip() {
  // Narrow context: does NOT re-render when manage/merge/import state changes —
  // homeTabCtxValue's useMemo deps intentionally exclude all dialog/manage fields.
  // React.memo prevents re-renders from parent re-renders (e.g. Home re-rendering
  // because manage-dialog state changed): with no prop changes + stable narrow
  // context, this component only re-renders when run data or the live clock tick.
  const { runStatus, currentRun, dayState, v, ve, setActiveTab, pauseRun } = useHomeTabCtx();

  const {
    calc, nowTime, elapsedBatchSec, casesPct, casesFreezerPct,
  } = useLiveRun();

  return (
    <div className="print:hidden sticky top-2 z-40">
      <div
        className="relative rounded-lg border border-border/60 bg-card/95 backdrop-blur shadow-lg overflow-hidden cursor-pointer"
        onClick={() => setActiveTab("run")}
        data-testid="compact-run-strip"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
        <div className="px-3 py-2.5 pt-3 flex items-center justify-between gap-3">
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {runStatus === "running" ? (
                <>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider truncate">
                    Running{currentRun?.startedAt ? <> · <ElapsedTimeBadge data-testid="strip-elapsed" nowMs={nowTime.getTime()} startedAt={currentRun.startedAt} pausedAt={currentRun.pausedAt ?? null} /></> : ""}
                  </span>
                </>
              ) : runStatus === "paused" ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Paused</span>
                </>
              ) : runStatus === "ended" ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Ended</span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Not started</span>
                </>
              )}
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-bold text-foreground truncate">
                {(currentRun?.brand || currentRun?.flavor)
                  ? <>{currentRun?.brand}{currentRun?.brand && currentRun?.flavor ? <span className="text-primary mx-1">—</span> : null}{currentRun?.flavor}</>
                  : "Unnamed Run"}
              </span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase shrink-0 inline-flex items-center">
                Run {dayState.currentIndex + 1}/{dayState.runs.length}
                <ChevronRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end text-right shrink-0">
            {v.casesNeeded > 0 && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm font-bold font-mono tabular-nums text-foreground">{fmtComma(calc.casesCompleted)}</span>
                <span className="text-[10px] text-muted-foreground">/ {fmtComma(v.casesNeeded)}</span>
                <span className="text-[10px] font-semibold text-primary tabular-nums">
                  {Math.round(Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100))}%
                </span>
                {calc.casesInFreezer > 0 && (
                  <span className="text-[10px] font-semibold text-sky-400 tabular-nums">+{fmtComma(calc.casesInFreezer)} in freezer</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              {calc.paceStatus !== null && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${
                  calc.paceStatus === "behind"
                    ? "text-red-400 bg-red-400/10 border-red-400/20"
                    : "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                }`}>
                  {calc.paceStatus === "on-pace" ? "✓ On Pace" : calc.paceStatus === "ahead" ? `▲ ${calc.paceDelta} ahead` : `▼ ${Math.abs(calc.paceDelta)} behind`}
                  {calc.ppm > 0 ? ` · ${calc.ppm} PPM` : ""}
                </span>
              )}
              {(runStatus === "running" || runStatus === "paused") && calc.totalTimeSec > 0 && (
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                  Est {fmtClock(Date.now() + calc.adjustedTimeSec * 1000)}
                </span>
              )}
            </div>
          </div>
          {(runStatus === "running" || runStatus === "paused") && (
            <div className="shrink-0 border-l border-border/50 pl-3">
              {runStatus === "running" ? (
                <button
                  type="button"
                  title="Pause run"
                  data-testid="strip-pause"
                  onClick={(e: any) => { e.stopPropagation(); pauseRun(); }}
                  className="bg-amber-600/20 text-amber-500 hover:bg-amber-500 hover:text-black p-2.5 rounded-lg transition-colors border border-amber-500/30"
                >
                  <Pause className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  title="Resume on Run tab"
                  data-testid="strip-resume"
                  onClick={(e: any) => { e.stopPropagation(); setActiveTab("run"); }}
                  className="bg-emerald-600/20 text-emerald-500 hover:bg-emerald-500 hover:text-black p-2.5 rounded-lg transition-colors border border-emerald-500/30"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              )}
            </div>
          )}
        </div>
        {v.casesNeeded > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted/40 flex">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${casesPct * 100}%` }} />
            {casesFreezerPct > 0 && (
              <div className="h-full bg-sky-400/60 transition-all duration-500" style={{ width: `${casesFreezerPct * 100}%` }} />
            )}
          </div>
        )}
        {/* Compact 3-phase line strip — shows the most active transition */}
        {!currentRun?.endedAt && (runStatus === "running" || runStatus === "paused") && (() => {
          const freezerMin = Number(ve.freezerTime) || 0;
          if (freezerMin <= 0) return null;
          if (calc.ppm <= 0 && runStatus === "running") return null;
          const preTun = Number(ve.preTunnelMin) > 0 ? Number(ve.preTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN;
          const postTun = Number(ve.postTunnelMin) > 0 ? Number(ve.postTunnelMin) : PRE_POST_TUNNEL_DEFAULT_MIN;
          const nowMs = nowTime.getTime();
          const lastClosedPause = (currentRun?.stoppages ?? [])
            .filter((s: any) => s.type === "pause" && s.endedAt)
            .reduce((best: any, s: any) => (!best || s.endedAt > best.endedAt ? s : best), null as any);
          const lastResumeWallMs = lastClosedPause?.endedAt ?? 0;
          const lastPauseStartWallMs = lastClosedPause?.startedAt ?? 0;
          const phases = computeLinePhases({
            elapsedBatchSec,
            pausedAt: currentRun?.pausedAt ?? null,
            lastResumeWallMs,
            lastPauseStartWallMs,
            runStatus: runStatus as string,
            preTunnelMin: preTun,
            postTunnelMin: postTun,
            freezerTime: freezerMin,
            nowMs,
            pressDone: !!calc.pressDone,
            casesInFreezer: calc.casesInFreezer,
            ppm: calc.ppm,
            pizzasPerCase: Number(v.pizzasPerCase) || 0,
          });
          // Show the most active transition: filling/draining/resuming (nearest deadline)
          // beats paused — during a pause, Stage 2/3 "still draining" is more informative
          // than Stage 1 "stopped".
          const active = pickMostActivePhase(phases);
          if (!active) return null;
          const mm = Math.floor(active.remainMs / 60000);
          const ss = Math.floor((active.remainMs % 60000) / 1000);
          const isDrain = active.state === "draining";
          const isPaused = active.state === "paused";
          const isResume = active.state === "resuming";
          const tone = isDrain
            ? { wrap: "bg-amber-950/30 border-amber-700/30", text: "text-amber-400" }
            : isPaused
            ? { wrap: "bg-muted/20 border-border/30", text: "text-muted-foreground" }
            : { wrap: "bg-sky-950/30 border-sky-700/30", text: "text-sky-400" };
          const label = isPaused
            ? `${active.label} — stopped`
            : isResume
            ? `${active.label} — product arriving in ${fmtCountdownParts(mm, ss)}`
            : isDrain
            ? `${active.label} — draining${active.remainMs > 0 ? " → " + fmtCountdownParts(mm, ss) : ""}`
            : `${active.label} — filling → ${fmtCountdownParts(mm, ss)}`;
          return (
            <div className={`mt-1 rounded-md border px-3 py-1.5 flex items-center justify-center gap-2 ${tone.wrap}`}>
              <Timer className={`w-3.5 h-3.5 shrink-0 ${tone.text}`} />
              <span className={`text-[11px] font-semibold ${tone.text}`}>{label}</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export default CompactRunStrip;
