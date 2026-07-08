import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Package, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import "./_group.css";

function fmtNum(n: number, d = 0) {
  if (!Number.isFinite(n)) return "—";
  return Number(n.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}

/* Mock run values */
const v: Record<string, string | number> = {
  cartoned: "cartoned",
  cartonsPerCase: 6,
  circles: "12in",
  shipper: "costco",
  skidStacking: "lucia",
  gripSheets: "every other layer",
  slipSheets: "yes",
  casesNeeded: 320,
  casesPerSkid: 48,
};
const calc = {
  casesCompleted: 213,
  casesLeftToRun: 107,
  casesOnLine: 38,
  extraCases: 0,
};
const draining = {
  name: "Lucia – Pepperoni",
  skids: 5,
  casesOnSkid: 39,
  casesPerSkid: 42,
  casesNeeded: 260,
  remainSecs: 11 * 60 + 24,
  totalSecs: 45 * 60,
};

function CompactStepper({
  label,
  value,
  onChange,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="h-12 w-12 rounded-l border border-r-0 border-input bg-muted/30 hover:bg-muted/50 text-lg font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none"
        >
          −
        </button>
        <div className={`flex-1 h-12 border-y border-input bg-background/50 flex items-center justify-center text-xl font-mono font-bold tabular-nums${atMax ? " text-amber-400" : " text-foreground"}`}>
          {value}
        </div>
        <button
          type="button"
          onClick={() => { if (!atMax) onChange(max !== undefined ? Math.min(max, value + 1) : value + 1); }}
          className={`h-12 w-12 rounded-r border border-l-0 border-input bg-muted/30 hover:bg-muted/50 text-lg font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}
          disabled={atMax}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function VariantC() {
  const [skids, setSkids] = useState(4);
  const [casesOnSkid, setCasesOnSkid] = useState(21);
  const [dSkids, setDSkids] = useState(draining.skids);
  const [dCases, setDCases] = useState(draining.casesOnSkid);
  const [drainingExpanded, setDrainingExpanded] = useState(false);

  const casesPerSkid = Number(v.casesPerSkid);
  const casesNeeded = Number(v.casesNeeded);
  const maxSkids = casesPerSkid > 0 ? Math.floor(casesNeeded / casesPerSkid) : undefined;
  
  const dDone = dSkids * draining.casesPerSkid + dCases;
  const dLeft = Math.max(0, draining.casesNeeded - dDone);

  const dPct = Math.min(1 - draining.remainSecs / draining.totalSecs, 1);
  const fillTotal = 25 * 60;
  const fillRemain = 8 * 60 + 42;
  const fillPct = Math.min((fillTotal - fillRemain) / fillTotal, 1);

  return (
    <div className="pkg-tab-scope min-h-screen bg-background text-foreground p-2 sm:p-4 max-w-md mx-auto">
      <Card className="bg-card/40 border-border/50 shadow-sm overflow-hidden">
        <CardContent className="p-3 sm:p-4 space-y-4">
          
          {/* Packaging Config Chips */}
          <div className="flex flex-wrap gap-1.5">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/30">
              Cartoned
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 text-foreground border border-border/50">
              {v.cartonsPerCase}/case
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 text-foreground border border-border/50">
              {v.circles} circles
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 text-foreground border border-border/50 capitalize">
              {v.shipper}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 text-foreground border border-border/50 capitalize">
              {v.skidStacking}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 text-foreground border border-border/50">
              {v.gripSheets}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/40 text-foreground border border-border/50">
              Slip: {v.slipSheets}
            </span>
          </div>

          <Separator className="opacity-30" />

          {/* Active Run */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold flex items-center gap-1.5">
                <Package className="w-4 h-4 text-primary" /> Active Run
              </h2>
              <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                <span className="text-emerald-400 font-bold">{fmtNum(calc.casesCompleted)} done</span>
                <span className="opacity-50">•</span>
                <span>{fmtNum(calc.casesLeftToRun)} left</span>
                <span className="opacity-50">•</span>
                <span>{fmtNum(calc.casesOnLine)} line</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <CompactStepper
                label="Skids"
                value={skids}
                onChange={setSkids}
                max={maxSkids}
              />
              <CompactStepper
                label="Cases on Skid"
                value={casesOnSkid}
                onChange={setCasesOnSkid}
                max={casesPerSkid > 0 ? casesPerSkid : undefined}
              />
            </div>

            {/* Segmented Progress Bar */}
            {casesPerSkid > 0 && (
              <div className="flex gap-[1px] h-1.5 bg-muted/20 rounded-sm overflow-hidden">
                {Array.from({ length: casesPerSkid }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 ${i < casesOnSkid ? "bg-primary" : "bg-transparent"}`}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => { setSkids(s => s + 1); setCasesOnSkid(0); }}
              className="w-full h-12 flex items-center justify-center gap-2 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 text-sm font-bold transition-colors active:scale-[0.98]"
            >
              <CheckCircle2 className="w-4 h-4" />
              Skid Done
            </button>
          </div>

          <Separator className="opacity-30" />

          {/* Freezer Status (Stacked bars) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-16 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">
                Filling
              </div>
              <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${fillPct * 100}%` }} />
              </div>
              <div className="w-10 text-[10px] font-mono text-muted-foreground text-right">
                {`${String(Math.floor(fillRemain / 60)).padStart(2, "0")}:${String(fillRemain % 60).padStart(2, "0")}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-16 text-[10px] font-semibold text-amber-500/70 uppercase tracking-wider text-right">
                Draining
              </div>
              <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${dPct * 100}%` }} />
              </div>
              <div className="w-10 text-[10px] font-mono text-amber-500/70 text-right">
                {`${String(Math.floor(draining.remainSecs / 60)).padStart(2, "0")}:${String(draining.remainSecs % 60).padStart(2, "0")}`}
              </div>
            </div>
          </div>

          {/* Prior Draining Run */}
          <div className="rounded border border-amber-900/30 bg-amber-950/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setDrainingExpanded(e => !e)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-amber-900/10 transition-colors"
            >
              <div className="flex flex-col">
                <span className="text-xs font-bold text-amber-500">{draining.name}</span>
                <span className="text-[10px] text-amber-500/60 font-mono">
                  {fmtNum(dDone)} done • {fmtNum(dLeft)} left
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-400 bg-amber-950/40 px-2 py-1 rounded">
                  {dCases} / {draining.casesPerSkid} cases
                </span>
                {drainingExpanded ? <ChevronUp className="w-4 h-4 text-amber-600" /> : <ChevronDown className="w-4 h-4 text-amber-600" />}
              </div>
            </button>

            {drainingExpanded && (
              <div className="p-3 pt-0 space-y-3 border-t border-amber-900/20">
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <CompactStepper
                    label="Skids"
                    value={dSkids}
                    onChange={setDSkids}
                  />
                  <CompactStepper
                    label="Cases"
                    value={dCases}
                    onChange={setDCases}
                    max={draining.casesPerSkid}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setDSkids(s => s + 1); setDCases(0); }}
                  className="w-full h-10 flex items-center justify-center gap-2 rounded bg-amber-600/10 hover:bg-amber-600/20 border border-amber-600/30 text-amber-500 text-xs font-bold transition-colors active:scale-[0.98]"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Prior Skid Done
                </button>
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
