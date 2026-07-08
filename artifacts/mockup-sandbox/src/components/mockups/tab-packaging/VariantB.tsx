import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Package, ArrowDown, Snowflake, Boxes, MoveDown, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import "./_group.css";

function fmtNum(n: number, d = 0) {
  if (!Number.isFinite(n)) return "—";
  return Number(n.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}

const PACKAGING_FIELDS = [
  { name: "cartoned", label: "Packaging Type" },
  { name: "circles", label: "Circles" },
  { name: "shipper", label: "Shipper" },
  { name: "skidStacking", label: "Skid Stacking Style" },
  { name: "gripSheets", label: "Grip Sheets" },
  { name: "slipSheets", label: "Slip Sheets" },
] as const;

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

function MiniStepper({
  value,
  onDec,
  onInc,
  max,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  max?: number;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div className="flex items-stretch h-12 w-full">
      <button
        type="button"
        onClick={onDec}
        className="w-12 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
      >
        −
      </button>
      <div className={`flex-1 border-y border-input bg-background/50 flex items-center justify-center text-lg font-mono font-bold tabular-nums${atMax ? " text-amber-400" : " text-foreground"}`}>
        {value}
      </div>
      <button
        type="button"
        onClick={() => { if (!atMax) onInc(); }}
        disabled={atMax}
        className={`w-12 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}
      >
        +
      </button>
    </div>
  );
}

function TimelineNode({ 
  icon: Icon, 
  active, 
  done, 
  last 
}: { 
  icon: React.ElementType, 
  active?: boolean, 
  done?: boolean, 
  last?: boolean 
}) {
  return (
    <div className="relative flex flex-col items-center w-8 shrink-0 mr-3 pt-2">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center z-10 border-2 ${
        done ? 'bg-emerald-950/80 border-emerald-600/50 text-emerald-400' :
        active ? 'bg-amber-950/80 border-amber-600/50 text-amber-400 shadow-[0_0_10px_rgba(217,119,6,0.3)]' :
        'bg-muted/50 border-muted text-muted-foreground'
      }`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      </div>
      {!last && (
        <div className={`w-0.5 grow mt-2 mb-[-8px] ${
          done ? 'bg-emerald-600/30' :
          active ? 'bg-gradient-to-b from-amber-600/50 to-muted' :
          'bg-muted'
        }`} />
      )}
    </div>
  );
}

export function VariantB() {
  const [skids, setSkids] = useState(4);
  const [casesOnSkid, setCasesOnSkid] = useState(21);
  const [dSkids, setDSkids] = useState(draining.skids);
  const [dCases, setDCases] = useState(draining.casesOnSkid);

  const casesPerSkid = Number(v.casesPerSkid);
  const casesNeeded = Number(v.casesNeeded);
  const maxSkids = casesPerSkid > 0 ? Math.floor(casesNeeded / casesPerSkid) : undefined;
  const skidNearlyFull =
    casesPerSkid > 0 && casesOnSkid > 0 &&
    casesOnSkid >= casesPerSkid - 3 && casesOnSkid < casesPerSkid;

  const dDone = dSkids * draining.casesPerSkid + dCases;
  const dLeft = Math.max(0, draining.casesNeeded - dDone);
  const dPct = Math.min(1 - draining.remainSecs / draining.totalSecs, 1);
  const dMm = Math.floor(draining.remainSecs / 60);
  const dSs = draining.remainSecs % 60;
  const dNearlyFull =
    dCases > 0 && dCases >= draining.casesPerSkid - 3 && dCases < draining.casesPerSkid;

  const fillTotal = 25 * 60;
  const fillRemain = 8 * 60 + 42;
  const fillPct = Math.min((fillTotal - fillRemain) / fillTotal, 1);

  return (
    <div className="pkg-tab-scope min-h-screen bg-background text-foreground pb-24 max-w-md mx-auto relative flex flex-col">
      <div className="p-4 flex-1">
        
        {/* Compact Config */}
        <Card className="bg-card/40 border-border/40 shadow-sm mb-6 rounded-xl">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/50">
              <div className="flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Packaging Spec</span>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-primary/10 text-primary border-primary/20">
                Cartoned
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="flex flex-col">
                <span className="text-[10px] text-muted-foreground uppercase">Cartons / Case</span>
                <span className="text-sm font-medium tabular-nums">{fmtNum(Number(v.cartonsPerCase), 0)}</span>
              </div>
              {PACKAGING_FIELDS.filter(f => f.name !== "cartoned").map(f => {
                const val = String(v[f.name] ?? "").trim();
                return (
                  <div key={f.name} className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase truncate">{f.label}</span>
                    <span className="text-sm font-medium capitalize truncate">{val || "—"}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Pipeline */}
        <div className="pl-1">
          
          {/* Stage 1: Line */}
          <div className="flex mb-6">
            <TimelineNode icon={MoveDown} done />
            <div className="flex-1 mt-1">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Line Assembly</h3>
              </div>
              <div className="bg-muted/10 border border-border/50 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Currently on line</span>
                <span className="text-2xl font-mono font-bold tabular-nums">{fmtNum(calc.casesOnLine, 0)} <span className="text-sm text-muted-foreground font-sans font-normal">cases</span></span>
              </div>
            </div>
          </div>

          {/* Stage 2: Freezer Filling */}
          <div className="flex mb-6">
            <TimelineNode icon={Snowflake} active />
            <div className="flex-1 mt-1">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider">Freezer Loading</h3>
                <span className="text-[10px] font-mono text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Active Run</span>
              </div>
              <Card className="bg-amber-950/10 border-amber-600/30 overflow-hidden">
                <CardContent className="p-3">
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-xs text-muted-foreground">Est. fill time remaining</span>
                    <span className="text-lg font-mono font-bold text-amber-400">
                      {String(Math.floor(fillRemain / 60)).padStart(2, "0")}:{String(fillRemain % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-background border border-amber-900/50 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 bg-amber-500"
                      style={{ width: `${fillPct * 100}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Stage 3: Freezer Draining */}
          <div className="flex mb-6">
            <TimelineNode icon={Zap} active />
            <div className="flex-1 mt-1">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider">Freezer Unloading</h3>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded">Prior Run</span>
              </div>
              <Card className="bg-amber-950/10 border-amber-600/40">
                <CardContent className="p-3 space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-foreground truncate">{draining.name}</span>
                      <span className="text-[10px] font-mono text-amber-400">
                        {String(dMm).padStart(2, "0")}:{String(dSs).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-background border border-amber-900/50 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000 bg-amber-500"
                        style={{ width: `${dPct * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1 uppercase">Cases / Skid {draining.skids + 1}</p>
                      <MiniStepper
                        value={dCases}
                        onDec={() => setDCases(c => Math.max(0, c - 1))}
                        onInc={() => setDCases(c => Math.min(draining.casesPerSkid, c + 1))}
                        max={draining.casesPerSkid}
                      />
                    </div>
                    <div className="flex flex-col items-center justify-center pt-4">
                      <button
                        type="button"
                        onClick={() => { setDSkids(s => s + 1); setDCases(0); }}
                        className="h-12 w-20 flex flex-col items-center justify-center rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 transition-colors active:scale-[0.96]"
                      >
                        <CheckCircle2 className="w-4 h-4 mb-0.5" />
                        <span className="text-[10px] font-bold uppercase leading-none">Done</span>
                      </button>
                    </div>
                  </div>
                  
                  {dNearlyFull && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-900/30 text-amber-400 text-[10px] font-semibold">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Skid nearly full — {draining.casesPerSkid - dCases} to go
                    </div>
                  )}

                  <div className="flex justify-between items-center bg-background/50 rounded p-2 text-xs border border-border/50">
                    <span className="text-muted-foreground">Total: <strong className="text-foreground">{dSkids}</strong> skids, <strong className="text-emerald-400">{dDone}</strong> cases</span>
                    <span className="text-muted-foreground"><strong className="text-foreground">{dLeft}</strong> remaining</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Stage 4: Skid Building */}
          <div className="flex">
            <TimelineNode icon={Boxes} last active />
            <div className="flex-1 mt-1">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider">Skid Building</h3>
                <span className="text-[10px] font-mono text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">Active Run</span>
              </div>
              <Card className="bg-amber-950/10 border-amber-600/40 shadow-[0_0_15px_rgba(217,119,6,0.1)]">
                <CardContent className="p-3 space-y-4">
                  <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Cases on Skid {skids + 1}</p>
                      <MiniStepper
                        value={casesOnSkid}
                        onDec={() => setCasesOnSkid(c => Math.max(0, c - 1))}
                        onInc={() => setCasesOnSkid(c => Math.min(casesPerSkid, c + 1))}
                        max={casesPerSkid}
                      />
                    </div>
                    <div className="flex flex-col items-center justify-center pt-5">
                      <button
                        type="button"
                        onClick={() => { setSkids(s => s + 1); setCasesOnSkid(0); }}
                        className="h-12 px-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 transition-colors active:scale-[0.96]"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase leading-none">Skid Done</span>
                      </button>
                    </div>
                  </div>

                  {skidNearlyFull && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/30 text-amber-400 text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Skid nearly full — {casesPerSkid - casesOnSkid} case{casesPerSkid - casesOnSkid !== 1 ? "s" : ""} to go
                    </div>
                  )}

                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] text-muted-foreground mb-1 uppercase">Total Skids Completed</p>
                    <div className="w-32">
                      <MiniStepper
                        value={skids}
                        onDec={() => setSkids(s => Math.max(0, s - 1))}
                        onInc={() => setSkids(s => s + 1)}
                        max={maxSkids}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          
        </div>
      </div>

      {/* Fixed Footer Summary */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-background/80 backdrop-blur-xl border-t border-border z-50">
        <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
          <div className="bg-muted/40 border border-border/50 rounded-lg py-2 px-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Done</span>
            <span className="text-xl font-mono font-bold text-emerald-400">{fmtNum(calc.casesCompleted, 0)}</span>
          </div>
          <div className="bg-muted/40 border border-border/50 rounded-lg py-2 px-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Left</span>
            <span className="text-xl font-mono font-bold">{fmtNum(calc.casesLeftToRun, 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
