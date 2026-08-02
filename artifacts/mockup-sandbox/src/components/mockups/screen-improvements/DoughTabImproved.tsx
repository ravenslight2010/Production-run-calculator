import React from "react";

export function DoughTabImproved() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Batch Pipeline card */}
        <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <div className="w-1 h-3.5 bg-amber-500 rounded-full mr-2" />
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Batch Pipeline · 3 max
              </span>
            </div>
            <button className="text-[10px] text-muted-foreground hover:text-amber-500 border border-border/40 px-2 py-0.5 rounded-md transition-colors">
              Pause
            </button>
          </div>

          {/* 3 KPI tiles — consistent label-above-value hierarchy */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5 flex flex-col items-center">
              <div className="text-[9px] uppercase tracking-widest font-medium text-muted-foreground/60 mb-1">Prepped</div>
              <div className="text-2xl font-bold tabular-nums text-foreground">2</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">waiting</div>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-2.5 flex flex-col items-center">
              <div className="text-[9px] uppercase tracking-widest font-medium text-amber-500/70 mb-1">Spinning</div>
              <div className="text-2xl font-bold tabular-nums text-amber-500">04:12</div>
              <div className="text-[9px] text-amber-500/60 mt-0.5">live timer</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5 flex flex-col items-center">
              <div className="text-[9px] uppercase tracking-widest font-medium text-muted-foreground/60 mb-1">Hopper</div>
              <div className="text-2xl font-bold tabular-nums text-foreground">11:38</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">feeds line</div>
            </div>
          </div>

          {/* Status strip */}
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
            <span className="font-bold">✓</span>
            <span>Keeping up · ~8 batches/hr, line needs 7</span>
          </div>
        </div>

        {/* Machine Times card */}
        <div className="rounded-xl border border-border/50 bg-card/60 px-3 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <div className="w-1 h-3.5 bg-border/60 rounded-full mr-2" />
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Machine Times</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">spin 6:30 + hopper 12:00</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["Mixer low", "Mixer high", "Hopper"].map((label, i) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">{label}</span>
                <div className="h-9 rounded-lg border border-border/50 bg-background flex items-center justify-center text-sm font-mono text-foreground">
                  {i === 0 ? "360" : i === 1 ? "420" : "720"}
                </div>
                <span className="text-[9px] text-muted-foreground/50 text-center">sec</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dough recipe card */}
        <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
          <div className="flex items-center mb-3">
            <div className="w-1 h-3.5 bg-border/60 rounded-full mr-2" />
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Recipe · Original Dough</span>
          </div>
          <div className="space-y-2">
            {[
              ["Flour", "50 lb"],
              ["Water", "30 lb"],
              ["Oil", "2.5 lb"],
              ["Salt", "1 lb"],
            ].map(([ing, qty]) => (
              <div key={ing} className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{ing}</span>
                <span className="text-sm font-mono tabular-nums text-foreground font-semibold">{qty}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border/40 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Batch size</span>
            <span className="text-sm font-bold tabular-nums">83.5 lb</span>
          </div>
        </div>

        {/* Batch count control */}
        <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">Batches Made</div>
              <div className="text-xs text-muted-foreground">7 total needed</div>
            </div>
            <div className="flex items-center gap-3">
              <button className="w-9 h-9 rounded-xl bg-muted/40 border border-border/50 text-foreground text-xl font-bold flex items-center justify-center hover:bg-muted/60 transition-colors">−</button>
              <span className="text-2xl font-bold tabular-nums w-8 text-center">5</span>
              <button className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xl font-bold flex items-center justify-center hover:bg-amber-500/20 transition-colors">+</button>
            </div>
          </div>
          <div className="mt-3 h-1 bg-muted/40 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: "71%" }} />
          </div>
        </div>

      </div>
    </div>
  );
}
