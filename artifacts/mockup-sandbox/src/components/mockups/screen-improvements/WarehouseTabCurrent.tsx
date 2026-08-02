import React from "react";

export function WarehouseTabCurrent() {
  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Freezer Pull card — sky colors */}
        <div className="rounded-lg border border-sky-700/40 bg-sky-950/30 shadow-md overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-sky-300 flex items-center gap-1.5 mb-0.5">
              ❄ Pull Out Freezer
            </div>
            <div className="text-xs text-sky-400/80">Tomorrow, Aug 3 · 2 runs</div>
          </div>
          <div className="px-5 pb-4 space-y-2">
            {[
              { run: "HEB Classic", item: "Mozzarella Blend", qty: "280 lb", early: "" },
              { run: "Lowe's Supreme", item: "Supreme Blend Mix", qty: "48 lb", early: "pull early — frozen" },
            ].map((r) => (
              <div key={r.run} className="rounded-md border border-sky-800/40 bg-sky-950/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-sky-100 font-semibold">{r.run}</div>
                    <div className="text-sm text-sky-200/90 mt-0.5">{r.item}</div>
                    {r.early && <div className="text-[10px] text-sky-400/70 mt-0.5">{r.early}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-base font-bold tabular-nums text-sky-50">{r.qty.split(" ")[0]}</span>
                    <span className="text-xs text-sky-300/80 ml-1">{r.qty.split(" ")[1]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cycle Count card — amber colors */}
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 shadow-md overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5 mb-0.5">
              📋 Time to Count
            </div>
            <div className="text-xs text-amber-400/80">2 sections due today</div>
          </div>
          <div className="px-5 pb-4 space-y-2">
            {[
              { section: "Dry Goods", status: "Due now" },
              { section: "Refrigerated", status: "Due now" },
            ].map((r) => (
              <div key={r.section} className="flex items-center justify-between gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 p-3">
                <div>
                  <div className="text-sm text-amber-100 font-semibold">{r.section}</div>
                  <div className="text-xs text-amber-400/80 mt-0.5">{r.status}</div>
                </div>
                <button className="shrink-0 flex items-center gap-1.5 rounded-md bg-amber-600 text-amber-50 text-xs font-semibold px-3 py-1.5">
                  ✓ Mark counted
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Total Ingredient Needs */}
        <div className="rounded-lg border border-border/50 bg-card/50 shadow-md overflow-hidden">
          <div className="h-1 bg-primary w-full" />
          <div className="px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Ingredient Needs
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">All active + scheduled runs today</div>
          </div>
          <div className="px-5 pb-4 space-y-1.5">
            {[
              ["Flour", "800 lb"],
              ["Mozzarella Blend", "480 lb"],
              ["Pepperoni", "122 lb"],
              ["Garlic Butter", "38 lb"],
            ].map(([ing, qty]) => (
              <div key={ing as string} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{ing}</span>
                <span className="font-mono tabular-nums text-foreground">{qty}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
