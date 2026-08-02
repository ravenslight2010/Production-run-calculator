import React from "react";

export function SauceTabCurrent() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Sauce Batches Needed card */}
        <div className="rounded-lg border border-border/50 bg-card/50 shadow-md overflow-hidden">
          <div className="h-1 bg-primary w-full" />
          <div className="px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              💧 Sauce Batches Needed
            </div>
          </div>
          <div className="px-5 pb-5">
            <p className="text-xs text-muted-foreground mb-4">
              Based on{" "}
              <span className="font-mono text-foreground">17</span> cases remaining ×{" "}
              <span className="font-mono text-foreground">8</span> pizzas/case
            </p>

            {/* BatchMadeRow — Garlic Butter */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">Garlic Butter</div>
                <div className="text-xs text-muted-foreground mt-0.5">3 batches · 1.2 barrels</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground text-base font-bold flex items-center justify-center">−</button>
                <div className="text-center">
                  <div className="text-lg font-bold tabular-nums text-foreground">1</div>
                  <div className="text-[9px] text-muted-foreground">made</div>
                </div>
                <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground text-base font-bold flex items-center justify-center">+</button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: "33%" }} />
            </div>
          </div>
        </div>

        {/* Sauce recipe card */}
        <div className="rounded-lg border border-border/50 bg-card/50 shadow-md overflow-hidden">
          <div className="h-1 bg-primary w-full" />
          <div className="px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recipe · Garlic Butter
            </div>
          </div>
          <div className="px-5 pb-4 space-y-2">
            {[
              ["Butter base", "12 lb"],
              ["Garlic powder", "0.5 lb"],
              ["Salt", "0.1 lb"],
            ].map(([ing, qty]) => (
              <div key={ing as string} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{ing}</span>
                <span className="font-mono tabular-nums text-foreground">{qty}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-border/40 flex justify-between">
              <span className="text-xs text-muted-foreground">Per barrel</span>
              <span className="text-sm font-bold tabular-nums">12.6 lb</span>
            </div>
          </div>
        </div>

        {/* Info note */}
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Sauce is made as-needed during the run. Tap + after each batch is done.
          </p>
        </div>

      </div>
    </div>
  );
}
