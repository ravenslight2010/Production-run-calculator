import React from "react";

export function FrontlineTabImproved() {
  // Station data: type, name, detail, hasStepper
  const stations = [
    { pos: "Sauce",  name: "Garlic Butter",      detail: "3 batches · 1.2 barrels", stepper: true,  made: 1 },
    { pos: "App 1",  name: "Supreme Blend Mix",  detail: "2 batches · 24 lb/batch", stepper: true,  made: 0 },
    { pos: "Pep",    name: "Pepperoni",           detail: "0.45 oz/pizza · 61 lb",   stepper: false, made: 0 },
    { pos: "App 3",  name: "Mozzarella",          detail: "3.2 oz/pizza · 136 lb",   stepper: false, made: 0 },
    { pos: "App 4",  name: "Blend",               detail: "1.1 oz/pizza · 47 lb",    stepper: false, made: 0 },
  ];

  return (
    <div className="dark min-h-screen bg-background text-foreground p-3">
      <div className="space-y-3">

        {/* Header card */}
        <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400" />
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center mb-1">
              <div className="w-1 h-3.5 bg-amber-500 rounded-full mr-2" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Batches Needed</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-mono font-semibold text-foreground">17</span> cases remaining ×{" "}
              <span className="font-mono font-semibold text-foreground">8</span> pizzas/case
            </p>
          </div>
        </div>

        {/* Station rows — each its own card for visual separation */}
        <div className="space-y-2">
          {stations.map((s, i) => (
            <div
              key={s.pos}
              className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
                s.stepper && s.made > 0
                  ? "border-amber-500/20 bg-amber-500/5"
                  : "border-border/50 bg-card/60"
              }`}
            >
              {/* Position badge */}
              <div className={`shrink-0 w-12 text-center rounded-lg px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider border ${
                s.pos === "Sauce"
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                  : s.pos === "Pep"
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-muted/30 border-border/40 text-muted-foreground"
              }`}>
                {s.pos}
              </div>

              {/* Name + detail */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{s.name}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.detail}</div>
              </div>

              {/* Stepper or bulk tag */}
              {s.stepper ? (
                <div className="flex items-center gap-2 shrink-0">
                  <button className="w-8 h-8 rounded-lg bg-muted/40 border border-border/50 text-foreground font-bold flex items-center justify-center hover:bg-muted/60 transition-colors text-base">−</button>
                  <div className="text-center w-6">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 leading-none mb-0.5">done</div>
                    <div className="text-lg font-bold tabular-nums text-foreground">{s.made}</div>
                  </div>
                  <button className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold flex items-center justify-center hover:bg-amber-500/20 transition-colors text-base">+</button>
                </div>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 shrink-0">bulk load</span>
              )}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
