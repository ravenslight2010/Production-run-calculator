import React from "react";

export function SauceTabImproved() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Sauce Batches Needed card */}
        <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
          {/* Gradient top accent instead of flat amber stripe */}
          <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400" />
          <div className="px-5 pt-4 pb-5">
            <div className="flex items-center mb-4">
              <div className="w-1 h-3.5 bg-amber-500 rounded-full mr-2" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Sauce Batches Needed
              </span>
            </div>

            {/* Context line */}
            <p className="text-xs text-muted-foreground mb-5">
              Based on{" "}
              <span className="font-mono font-semibold text-foreground">17</span> cases remaining ×{" "}
              <span className="font-mono font-semibold text-foreground">8</span> pizzas/case
            </p>

            {/* BatchMadeRow — label hierarchy: name prominent, detail secondary */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">Recipe</div>
                <div className="text-base font-bold text-foreground truncate">Garlic Butter</div>
                <div className="text-xs text-muted-foreground mt-0.5">3 needed · 1.2 barrels</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button className="w-9 h-9 rounded-xl bg-muted/40 border border-border/50 text-foreground text-xl font-bold flex items-center justify-center hover:bg-muted/60 transition-colors">−</button>
                <div className="text-center">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">Made</div>
                  <div className="text-2xl font-bold tabular-nums text-foreground">1</div>
                </div>
                <button className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xl font-bold flex items-center justify-center hover:bg-amber-500/20 transition-colors">+</button>
              </div>
            </div>

            {/* Progress bar — unified amber token */}
            <div className="mt-4 h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: "33%" }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-muted-foreground/60">1 done</span>
              <span className="text-[9px] text-muted-foreground/60">2 remaining</span>
            </div>
          </div>
        </div>

        {/* Sauce recipe card — cleaner, no redundant stripe */}
        <div className="rounded-xl border border-border/50 bg-card/60 px-5 py-4">
          <div className="flex items-center mb-3">
            <div className="w-1 h-3.5 bg-border/60 rounded-full mr-2" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recipe · Garlic Butter
            </span>
          </div>
          <div className="space-y-2">
            {[
              ["Butter base", "12 lb"],
              ["Garlic powder", "0.5 lb"],
              ["Salt", "0.1 lb"],
            ].map(([ing, qty]) => (
              <div key={ing as string} className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{ing}</span>
                <span className="text-sm font-mono tabular-nums text-foreground font-semibold">{qty}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border/40 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Per barrel</span>
            <span className="text-sm font-bold tabular-nums">12.6 lb</span>
          </div>
        </div>

        {/* Hint — tighter, less boxy */}
        <p className="text-xs text-muted-foreground/60 px-1 text-center">
          Tap + after each sauce batch is done
        </p>

      </div>
    </div>
  );
}
