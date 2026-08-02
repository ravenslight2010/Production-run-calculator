import React from "react";

export function DoughTabCurrent() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Batch Pipeline card */}
        <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Batch Pipeline · 3 max
            </span>
            <button className="text-[9px] text-muted-foreground hover:text-amber-400 border border-border/40 px-1.5 py-0.5 rounded">
              Pause
            </button>
          </div>

          {/* 3 KPI tiles */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/20 border border-border/30 p-2.5 text-center">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">1 · Prepped</div>
              <div className="text-lg font-bold tabular-nums text-foreground">2</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">Waiting</div>
            </div>
            <div className="rounded-lg bg-primary/10 border border-primary/30 p-2.5 text-center">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">2 · Spinning</div>
              <div className="text-lg font-bold tabular-nums text-primary">04:12</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">counts while running</div>
            </div>
            <div className="rounded-lg bg-muted/20 border border-border/30 p-2.5 text-center">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">3 · In Hopper</div>
              <div className="text-lg font-bold tabular-nums text-orange-400">11:38</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">feeds the line</div>
            </div>
          </div>

          {/* Keeping-up status */}
          <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-400">
            <span>✓</span>
            <span>Keeping up: ~8 batches/hr, line needs 7</span>
          </div>
        </div>

        {/* Machine Times card */}
        <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              ⏱ Machine Times
            </span>
            <span className="text-[10px] text-muted-foreground">spin 6:30 + hopper 12:00</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["Mixer low (sec)", "Mixer high (sec)", "Hopper (sec)"].map((label, i) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
                <div className="h-8 rounded border border-border/60 bg-background/60 flex items-center justify-center text-sm font-mono text-foreground">
                  {i === 0 ? "360" : i === 1 ? "420" : "720"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dough recipe card */}
        <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Recipe · Original Dough
          </div>
          <div className="space-y-1.5">
            {[
              ["Flour", "50 lb"],
              ["Water", "30 lb"],
              ["Oil", "2.5 lb"],
              ["Salt", "1 lb"],
            ].map(([ing, qty]) => (
              <div key={ing} className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{ing}</span>
                <span className="font-mono tabular-nums text-foreground">{qty}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border/40 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Batch size</span>
            <span className="text-sm font-bold tabular-nums">83.5 lb</span>
          </div>
        </div>

        {/* Batch count control */}
        <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Batches Made
            </span>
            <div className="flex items-center gap-3">
              <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground text-lg font-bold flex items-center justify-center">−</button>
              <span className="text-xl font-bold tabular-nums w-6 text-center">5</span>
              <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground text-lg font-bold flex items-center justify-center">+</button>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground text-right">7 total needed</div>
        </div>

      </div>
    </div>
  );
}
