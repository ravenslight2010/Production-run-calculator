import React from "react";

export function WarehouseTabImproved() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Freezer Pull — unified amber instead of sky */}
        <div className="rounded-xl border border-amber-500/20 bg-card/60 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400" />
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-1 h-3.5 bg-amber-500 rounded-full mr-2" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pull Out Freezer</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Tomorrow, Aug 3 · 2 runs</span>
            </div>
          </div>
          <div className="px-5 pb-4 space-y-2">
            {[
              { run: "HEB Classic", item: "Mozzarella Blend", qty: "280 lb", note: "" },
              { run: "Lowe's Supreme", item: "Supreme Blend Mix", qty: "48 lb", note: "pull early — frozen" },
            ].map((r) => (
              <div key={r.run} className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">{r.run}</div>
                    <div className="text-sm font-semibold text-foreground">{r.item}</div>
                    {r.note && <div className="text-[10px] text-amber-500/70 mt-0.5">{r.note}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-lg font-bold tabular-nums text-foreground">{r.qty.split(" ")[0]}</span>
                    <span className="text-xs text-muted-foreground ml-1">{r.qty.split(" ")[1]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cycle Count — consistent amber accent, left-border anchor */}
        <div className="rounded-xl border border-border/50 border-l-4 border-l-amber-500 bg-card/60 overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Time to Count</span>
              <span className="text-[10px] text-amber-500 font-semibold">2 due today</span>
            </div>
          </div>
          <div className="px-5 pb-4 space-y-2">
            {[
              { section: "Dry Goods", status: "Due now" },
              { section: "Refrigerated", status: "Due now" },
            ].map((r) => (
              <div key={r.section} className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/50 px-3 py-2.5">
                <div>
                  <div className="text-sm font-semibold text-foreground">{r.section}</div>
                  <div className="text-[10px] text-amber-500/70 mt-0.5">{r.status}</div>
                </div>
                <button className="shrink-0 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-semibold px-3 py-1.5 hover:bg-amber-500/20 transition-colors">
                  ✓ Mark counted
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Total Ingredient Needs — clean, no decorative stripe */}
        <div className="rounded-xl border border-border/50 bg-card/60 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <div className="w-1 h-3.5 bg-border/60 rounded-full mr-2" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ingredient Needs Today</span>
            </div>
            <span className="text-[10px] text-muted-foreground">all runs</span>
          </div>
          <div className="space-y-2">
            {[
              ["Flour", "800 lb"],
              ["Mozzarella Blend", "480 lb"],
              ["Pepperoni", "122 lb"],
              ["Garlic Butter", "38 lb"],
            ].map(([ing, qty]) => (
              <div key={ing as string} className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{ing}</span>
                <span className="text-sm font-mono tabular-nums text-foreground font-semibold">{qty}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
