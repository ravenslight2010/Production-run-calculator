import React from "react";

export function RunTabCurrent() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3 mb-4">

        {/* Top bar: run position badge + actions */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider bg-muted/40 px-2 py-1 rounded border border-border/50">
            Run 2 of 4
          </span>
          <div className="flex gap-1.5">
            <button className="h-6 px-2 text-xs rounded border border-border/50 text-muted-foreground bg-muted/30">Templates</button>
            <button className="h-6 px-2 text-xs rounded border border-border/50 text-muted-foreground bg-muted/30">Copy</button>
            <button className="h-6 px-2 text-xs rounded border border-amber-500/20 text-amber-500 bg-amber-500/10">+ New Run</button>
          </div>
        </div>

        {/* Run Setup card */}
        <div className="rounded-xl border-2 border-border/70 bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Run Setup</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 border border-border/50 text-muted-foreground tabular-nums">
              #2
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-background/60 border border-border/60 rounded-lg p-2.5">
              <div className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Brand</div>
              <div className="text-sm font-semibold">Lowe's</div>
            </div>
            <div className="bg-background/60 border border-border/60 rounded-lg p-2.5">
              <div className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Flavor</div>
              <div className="text-sm font-semibold">Supreme</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Target Cases</span>
            <span className="text-sm font-bold tabular-nums">48</span>
          </div>
        </div>

        {/* Status controls — paused state */}
        <div className="rounded-xl border border-amber-600/40 bg-amber-950/20 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-amber-400 mb-1">
            <span className="font-semibold uppercase tracking-wide">⏸ Run Paused</span>
            <span className="text-muted-foreground ml-auto">00:47:23 elapsed</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold py-3">Resume</button>
            <button className="rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-bold py-3">Stop Run</button>
          </div>
          <button className="w-full rounded-xl border border-orange-700/60 text-orange-400 text-xs py-2">
            Log Stoppage Reason
          </button>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border/60 bg-card/60 p-3 shadow-lg text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Done</div>
            <div className="text-xl font-bold tabular-nums text-foreground">31</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">of 48 cases</div>
            <div className="mt-1.5 h-1 w-full bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full" style={{width: '65%'}} />
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 p-3 shadow-lg text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Pace</div>
            <div className="text-xl font-bold tabular-nums text-red-400">–4</div>
            <div className="text-[10px] text-red-400/70 mt-0.5">behind</div>
            <div className="mt-1.5 px-1.5 py-0.5 rounded text-[9px] bg-red-400/10 border border-red-400/20 text-red-400 text-center">
              39.6/hr actual
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 p-3 shadow-lg text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Finish</div>
            <div className="text-xl font-bold tabular-nums text-foreground">2:14</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">PM est.</div>
            <div className="mt-1.5 px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-400 text-center">
              +18 min late
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
