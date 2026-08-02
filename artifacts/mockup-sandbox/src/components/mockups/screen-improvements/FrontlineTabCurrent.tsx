import React from "react";

export function FrontlineTabCurrent() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Batches Needed card */}
        <div className="rounded-lg border border-border/50 bg-card/50 shadow-md overflow-hidden mb-4">
          <div className="h-1 bg-primary w-full" />
          <div className="px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              📦 Batches Needed
            </div>
          </div>
          <div className="px-5 pb-5">
            <p className="text-xs text-muted-foreground mb-4">
              Based on <span className="font-mono text-foreground">17</span> cases × <span className="font-mono text-foreground">8</span> pizzas/case
            </p>

            {/* Sauce row */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">Sauce</div>
                <div className="text-xs text-muted-foreground">Garlic Butter · 3 batches · 1.2 barrels</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center">−</button>
                <span className="text-lg font-bold tabular-nums w-6 text-center text-foreground">1</span>
                <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center">+</button>
              </div>
            </div>

            <div className="border-t border-border/60" />

            {/* App 1 — Mix */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">App 1</div>
                <div className="text-xs text-muted-foreground">Supreme Blend Mix · 2 batches · 24 lb/batch</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center">−</button>
                <span className="text-lg font-bold tabular-nums w-6 text-center text-foreground">0</span>
                <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center">+</button>
              </div>
            </div>

            <div className="border-t border-border/60" />

            {/* Pepperoni */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">Pepperoni</div>
                <div className="text-xs text-muted-foreground">0.45 oz/pizza · 61 lb total</div>
              </div>
              <div className="text-xs text-muted-foreground">bulk load</div>
            </div>

            <div className="border-t border-border/60" />

            {/* App 3 — Cheese */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">App 3</div>
                <div className="text-xs text-muted-foreground">Mozzarella · 3.2 oz/pizza · 136 lb total</div>
              </div>
              <div className="text-xs text-muted-foreground">bulk load</div>
            </div>

            <div className="border-t border-border/60" />

            {/* App 4 — Cheese */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">App 4</div>
                <div className="text-xs text-muted-foreground">Blend · 1.1 oz/pizza · 47 lb total</div>
              </div>
              <div className="text-xs text-muted-foreground">bulk load</div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
