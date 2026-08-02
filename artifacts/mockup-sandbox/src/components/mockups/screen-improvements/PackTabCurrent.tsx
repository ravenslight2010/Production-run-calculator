import React from "react";

export function PackTabCurrent() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="flex flex-col space-y-3">

        {/* Draining prior run — amber timeline node */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1">
            <div className="w-6 h-6 rounded-full bg-amber-600/30 border border-amber-600/60 flex items-center justify-center text-amber-400 text-[10px]">⚡</div>
            <div className="w-px flex-1 bg-border/40 mt-1" />
          </div>
          <div className="flex-1 rounded-xl border border-amber-600/30 bg-amber-950/30 p-3 mb-1">
            <div className="relative mb-2">
              <div className="h-0.5 bg-amber-950 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: "72%" }} />
              </div>
            </div>
            <div className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-1">Draining Prior Run</div>
            <div className="text-sm font-bold text-amber-100 mb-1">HEB Classic — 48 cases</div>
            <div className="text-xs text-amber-500 mb-3">12:14 remaining</div>
            <div className="grid grid-cols-2 gap-2">
              {/* Skids mini-stepper */}
              <div className="bg-amber-950/30 rounded-lg p-2 text-center border border-amber-800/30">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Skids</div>
                <div className="flex items-center justify-center gap-2">
                  <button className="w-6 h-6 text-xs rounded bg-muted/30 border border-border/40 text-muted-foreground">−</button>
                  <span className="text-base font-bold text-foreground">3</span>
                  <button className="w-6 h-6 text-xs rounded bg-muted/30 border border-border/40 text-muted-foreground">+</button>
                </div>
              </div>
              {/* Cases on skid */}
              <div className="bg-amber-950/30 rounded-lg p-2 text-center border border-amber-800/30">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Cases on skid</div>
                <div className="flex items-center justify-center gap-2">
                  <button className="w-6 h-6 text-xs rounded bg-muted/30 border border-border/40 text-muted-foreground">−</button>
                  <span className="text-base font-bold text-foreground">11</span>
                  <button className="w-6 h-6 text-xs rounded bg-muted/30 border border-border/40 text-muted-foreground">+</button>
                </div>
              </div>
            </div>
            <button className="mt-2 w-full rounded-lg border border-emerald-500/40 bg-emerald-600/20 text-emerald-400 text-xs py-1.5 font-semibold">
              ✓ Skid Done
            </button>
          </div>
        </div>

        {/* Freezer Loading */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1">
            <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary text-[10px]">❄</div>
            <div className="w-px flex-1 bg-border/40 mt-1" />
          </div>
          <div className="flex-1 rounded-lg border border-primary/20 bg-primary/5 p-3 mb-1">
            <div className="text-xs font-semibold text-primary/80 mb-2">Freezer Loading</div>
            <div className="w-full h-1.5 rounded-full bg-background border border-primary/10 overflow-hidden">
              <div className="h-full rounded-full bg-primary shadow-[0_0_10px_rgba(255,149,0,0.5)]" style={{ width: "55%" }} />
            </div>
            <div className="text-[10px] text-primary/80 mt-1">22 of 40 skids loaded</div>
          </div>
        </div>

        {/* Line Assembly */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1">
            <div className="w-6 h-6 rounded-full bg-muted/30 border border-border/50 flex items-center justify-center text-muted-foreground text-[10px]">↓</div>
            <div className="w-px flex-1 bg-border/40 mt-1" />
          </div>
          <div className="flex-1 rounded-lg border border-border/40 bg-muted/10 p-3 mb-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Line Assembly</span>
              <span className="text-sm font-semibold text-foreground">136 cases on line</span>
            </div>
          </div>
        </div>

        {/* Active Skid Building */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1">
            <div className="w-6 h-6 rounded-full bg-primary/30 border border-primary/60 flex items-center justify-center text-primary text-[10px]">■</div>
          </div>
          <div className="flex-1 rounded-2xl border border-primary/30 bg-card/60 shadow-[0_8px_30px_rgba(255,149,0,0.08)] overflow-hidden mb-1">
            <div className="bg-primary/5 border-b border-primary/20 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">Active Skid Building</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] text-primary/80">Auto</span>
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              {/* Skids completed */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Skids Completed</span>
                <div className="flex items-center gap-2">
                  <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-muted-foreground font-bold flex items-center justify-center">−</button>
                  <span className="text-xl font-bold tabular-nums w-8 text-center text-foreground">2</span>
                  <span className="text-sm text-muted-foreground">/ 5</span>
                  <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-muted-foreground font-bold flex items-center justify-center">+</button>
                </div>
              </div>
              {/* Cases on current skid */}
              <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Cases on Skid</span>
                  <div className="flex items-center gap-2">
                    <button className="w-7 h-7 rounded bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center">−</button>
                    <span className="text-lg font-bold tabular-nums w-6 text-center">8</span>
                    <span className="text-xs text-muted-foreground">/ 18</span>
                    <button className="w-7 h-7 rounded bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center">+</button>
                  </div>
                </div>
                <div className="relative w-full h-2 rounded-full bg-muted/30 border border-border/40 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary shadow-[0_0_15px_rgba(255,149,0,0.6)]" style={{ width: "44%" }} />
                </div>
              </div>
              <button className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5 transition-colors">
                ✓ Skid Done &amp; Log
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
