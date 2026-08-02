import React from "react";

export function PackTabImproved() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="flex flex-col space-y-2">

        {/* Draining prior run — left-border anchor instead of full amber background */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-500 text-[9px] shrink-0">⚡</div>
            <div className="w-px flex-1 bg-border/30 mt-1" />
          </div>
          <div className="flex-1 rounded-xl border border-amber-500/20 border-l-4 border-l-amber-500 bg-card/60 p-3 mb-1">
            {/* Progress strip at top */}
            <div className="h-0.5 bg-muted/30 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: "72%" }} />
            </div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-amber-500/70 mb-0.5">Draining Prior Run</div>
                <div className="text-sm font-bold text-foreground">HEB Classic — 48 cases</div>
              </div>
              <span className="text-xs font-mono font-semibold text-amber-500">12:14</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[["Skids", "3"], ["Cases on skid", "11"]].map(([label, val]) => (
                <div key={label} className="rounded-lg border border-border/50 bg-card/60 p-2 text-center">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</div>
                  <div className="flex items-center justify-center gap-1.5">
                    <button className="w-5 h-5 text-[10px] rounded bg-muted/30 border border-border/40 text-muted-foreground">−</button>
                    <span className="text-base font-bold tabular-nums">{val}</span>
                    <button className="w-5 h-5 text-[10px] rounded bg-muted/30 border border-border/40 text-muted-foreground">+</button>
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/8 text-emerald-500 text-xs py-1.5 font-semibold hover:bg-emerald-500/15 transition-colors">
              ✓ Skid Done
            </button>
          </div>
        </div>

        {/* Freezer Loading — unified amber accent */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-500 text-[9px] shrink-0">❄</div>
            <div className="w-px flex-1 bg-border/30 mt-1" />
          </div>
          <div className="flex-1 rounded-xl border border-border/50 bg-card/60 p-3 mb-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">Freezer Loading</span>
              <span className="text-[10px] text-muted-foreground font-mono">22 / 40 skids</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: "55%" }} />
            </div>
          </div>
        </div>

        {/* Line Assembly — minimal */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-5 h-5 rounded-full bg-muted/30 border border-border/50 flex items-center justify-center text-muted-foreground text-[9px] shrink-0">↓</div>
            <div className="w-px flex-1 bg-border/30 mt-1" />
          </div>
          <div className="flex-1 rounded-xl border border-border/50 bg-card/60 px-3 py-2.5 mb-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Line Assembly</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">136 cases on line</span>
            </div>
          </div>
        </div>

        {/* Active Skid Building — hero card */}
        <div className="flex gap-2">
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-5 h-5 rounded-full bg-amber-500/30 border border-amber-500 flex items-center justify-center text-amber-500 text-[9px] shrink-0">■</div>
          </div>
          <div className="flex-1 rounded-xl border border-amber-500/20 bg-card/60 overflow-hidden">
            <div className="bg-amber-500/8 border-b border-amber-500/15 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-500">Active Skid Building</span>
              </div>
              <button className="text-[9px] text-muted-foreground border border-border/40 px-2 py-0.5 rounded-md">Auto</button>
            </div>
            <div className="px-4 py-3 space-y-3">
              {/* Skids completed */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">Skids Completed</div>
                  <div className="text-xs text-muted-foreground">2 of 5 target</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="w-9 h-9 rounded-xl bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center hover:bg-muted/60 transition-colors text-lg">−</button>
                  <span className="text-2xl font-bold tabular-nums w-8 text-center text-foreground">2</span>
                  <button className="w-9 h-9 rounded-xl bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center hover:bg-muted/60 transition-colors text-lg">+</button>
                </div>
              </div>

              {/* Cases on skid */}
              <div className="rounded-xl border border-border/50 bg-background/50 p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">Cases on Skid</div>
                    <div className="text-xs text-muted-foreground">8 of 18</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="w-8 h-8 rounded-xl bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center hover:bg-muted/60 transition-colors">−</button>
                    <span className="text-xl font-bold tabular-nums w-7 text-center text-foreground">8</span>
                    <button className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold flex items-center justify-center hover:bg-amber-500/20 transition-colors">+</button>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500 transition-all shadow-[0_0_8px_rgba(255,149,0,0.4)]" style={{ width: "44%" }} />
                </div>
              </div>

              {/* Primary action */}
              <button className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black py-3.5 transition-colors">
                ✓ Skid Done &amp; Log
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
