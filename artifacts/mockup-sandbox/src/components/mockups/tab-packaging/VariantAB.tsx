import { useState } from "react";
import { AlertTriangle, CheckCircle2, Package, Sparkles, ChevronDown, ChevronUp, MoveDown, Snowflake, Zap, Boxes } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex items-stretch h-10 w-full">
      <button
        type="button"
        onClick={onDec}
        className="w-10 rounded-l-md border border-r-0 border-amber-700/30 bg-amber-950/50 hover:bg-amber-900/50 text-xl font-bold text-amber-400 transition-colors shrink-0 active:bg-amber-900/80 select-none"
      >
        −
      </button>
      <div className={`flex-1 border-y border-amber-700/30 bg-background/20 flex items-center justify-center text-lg font-mono font-bold tabular-nums${atMax ? " text-amber-500" : " text-amber-100"}`}>
        {value}
        {max && <span className="text-xs text-amber-500/70 ml-1 font-sans font-normal">/{max}</span>}
      </div>
      <button
        type="button"
        onClick={() => { if (!atMax) onInc(); }}
        disabled={atMax}
        className={`w-10 rounded-r-md border border-l-0 border-amber-700/30 bg-amber-950/50 hover:bg-amber-900/50 text-xl font-bold text-amber-400 transition-colors shrink-0 active:bg-amber-900/80 select-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}
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
    <div className="relative flex flex-col items-center w-10 shrink-0 mr-3 pt-2">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 border-2 ${
        done ? 'bg-emerald-950/80 border-emerald-600/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]' :
        active ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_rgba(255,149,0,0.3)]' :
        'bg-muted/50 border-muted text-muted-foreground'
      }`}>
        {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
      </div>
      {!last && (
        <div className={`w-1 grow mt-2 mb-[-8px] rounded-full ${
          done ? 'bg-emerald-600/30' :
          active ? 'bg-gradient-to-b from-primary/50 to-muted' :
          'bg-muted'
        }`} />
      )}
    </div>
  );
}

export function VariantAB() {
  const [skids, setSkids] = useState(4);
  const [casesOnSkid, setCasesOnSkid] = useState(21);
  const [autoTrack, setAutoTrack] = useState(true);
  const [dSkids, setDSkids] = useState(draining.skids);
  const [dCases, setDCases] = useState(draining.casesOnSkid);
  const [configExpanded, setConfigExpanded] = useState(false);

  const casesPerSkid = Number(v.casesPerSkid);
  const skidNearlyFull =
    casesPerSkid > 0 && casesOnSkid > 0 &&
    casesOnSkid >= casesPerSkid - 3 && casesOnSkid < casesPerSkid;

  const dDone = dSkids * draining.casesPerSkid + dCases;
  const dLeft = Math.max(0, draining.casesNeeded - dDone);
  const dPct = Math.min(1 - draining.remainSecs / draining.totalSecs, 1);
  const dMm = Math.floor(draining.remainSecs / 60);
  const dSs = draining.remainSecs % 60;
  
  const fillTotal = 25 * 60;
  const fillRemain = 8 * 60 + 42;
  const fillPct = Math.min((fillTotal - fillRemain) / fillTotal, 1);

  return (
    <div className="pkg-tab-scope min-h-screen bg-background text-foreground p-4 max-w-md mx-auto flex flex-col pb-20">
      
      {/* ── Top Dashboard Metrics ── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-muted/20 border border-border/30 rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cases Done</span>
          <span className="text-2xl font-mono font-black tabular-nums text-emerald-400">{fmtNum(calc.casesCompleted, 0)}</span>
        </div>
        <div className="bg-muted/20 border border-border/30 rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cases Left</span>
          <span className="text-2xl font-mono font-black tabular-nums text-foreground">{fmtNum(calc.casesLeftToRun, 0)}</span>
        </div>
      </div>

      {/* ── Pipeline Story ── */}
      <div className="flex-1 flex flex-col">
        
        {/* Stage 1: Line */}
        <div className="flex mb-4">
          <TimelineNode icon={MoveDown} done />
          <div className="flex-1 mt-2">
            <div className="flex items-center justify-between bg-muted/10 border border-border/40 rounded-lg p-3">
              <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Line Assembly</span>
              <span className="text-lg font-mono font-bold tabular-nums text-foreground">{fmtNum(calc.casesOnLine, 0)} <span className="text-xs text-muted-foreground font-sans font-normal uppercase tracking-widest">on line</span></span>
            </div>
          </div>
        </div>

        {/* Stage 2: Freezer Draining */}
        <div className="flex mb-4">
          <TimelineNode icon={Zap} active />
          <div className="flex-1 mt-2">
            <div className="bg-amber-950/30 border border-amber-600/30 rounded-xl p-3 relative overflow-hidden flex flex-col gap-3">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-950">
                <div className="h-full bg-amber-500 transition-all duration-1000" style={{ width: `${dPct * 100}%` }} />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-0.5">Draining Prior Run</p>
                  <p className="text-sm font-semibold text-amber-100 truncate max-w-[160px]">{draining.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono font-bold text-amber-500 mb-0.5">
                    {String(dMm).padStart(2, "0")}:{String(dSs).padStart(2, "0")} left
                  </p>
                  <p className="text-[10px] font-bold uppercase text-amber-200">{fmtNum(dDone)} / {draining.casesNeeded} cases</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <div className="flex-1">
                  <MiniStepper
                    value={dCases}
                    onDec={() => setDCases(c => Math.max(0, c - 1))}
                    onInc={() => setDCases(c => Math.min(draining.casesPerSkid, c + 1))}
                    max={draining.casesPerSkid}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setDSkids(s => s + 1); setDCases(0); }}
                  className="w-12 h-10 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 rounded-lg flex items-center justify-center active:scale-95 transition-all"
                >
                  <CheckCircle2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Stage 3: Freezer Filling */}
        <div className="flex mb-4">
          <TimelineNode icon={Snowflake} active />
          <div className="flex-1 mt-2">
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm font-semibold uppercase tracking-wider text-primary">Freezer Loading</span>
                <span className="text-xs font-mono font-bold text-primary/80">
                  {String(Math.floor(fillRemain / 60)).padStart(2, "0")}:{String(fillRemain % 60).padStart(2, "0")} rem
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-background border border-primary/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 bg-primary shadow-[0_0_10px_rgba(255,149,0,0.5)]"
                  style={{ width: `${fillPct * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stage 4: Skid Building (HUGE HERO) */}
        <div className="flex">
          <TimelineNode icon={Boxes} last active />
          <div className="flex-1 mt-2">
            
            <div className="bg-card/60 border border-primary/30 rounded-2xl overflow-hidden shadow-[0_8px_30px_rgba(255,149,0,0.08)] flex flex-col">
              <div className="px-4 py-3 flex items-center justify-between bg-primary/5 border-b border-primary/20">
                <h3 className="text-sm font-bold text-primary uppercase tracking-wider">Active Skid Building</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${autoTrack ? "bg-primary animate-pulse shadow-[0_0_8px_rgba(255,149,0,0.8)]" : "bg-muted-foreground"}`} />
                  <button
                    type="button"
                    onClick={() => setAutoTrack(a => !a)}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" /> {autoTrack ? "Auto" : "Manual"}
                  </button>
                </div>
              </div>

              <div className="p-5 text-center space-y-5">
                <div>
                  <div className="flex justify-center items-end gap-3 font-mono">
                    <button 
                      type="button" 
                      onClick={() => setSkids(s => Math.max(0, s - 1))}
                      className="w-12 h-16 rounded-xl bg-muted/40 text-2xl font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mb-1 select-none flex items-center justify-center"
                    >
                      −
                    </button>
                    <div className="text-[5rem] leading-[1] font-black tabular-nums tracking-tighter text-foreground drop-shadow-md">{skids}</div>
                    <button 
                      type="button" 
                      onClick={() => setSkids(s => s + 1)}
                      className="w-12 h-16 rounded-xl bg-muted/40 text-2xl font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mb-1 select-none flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-2">Skids Completed</p>
                </div>

                <div className="bg-background/50 rounded-xl p-4 border border-border/50 shadow-inner">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cases on Skid</span>
                    <div className="font-mono text-xl font-bold tabular-nums">
                      <span className="text-foreground">{casesOnSkid}</span>
                      <span className="text-muted-foreground">/{casesPerSkid}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      type="button" 
                      onClick={() => setCasesOnSkid(c => Math.max(0, c - 1))}
                      className="w-14 h-12 rounded-lg bg-muted/40 border border-border/50 text-2xl font-bold text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 select-none flex items-center justify-center"
                    >
                      −
                    </button>
                    <div className="flex-1 relative h-8 bg-muted/30 rounded-md overflow-hidden border border-border/40">
                      <div 
                        className="absolute inset-y-0 left-0 bg-primary transition-all duration-300 ease-out shadow-[0_0_15px_rgba(255,149,0,0.6)]"
                        style={{ width: `${(casesOnSkid / casesPerSkid) * 100}%` }}
                      />
                      {skidNearlyFull && (
                        <div className="absolute inset-0 flex items-center justify-center text-primary-foreground font-bold text-[10px] uppercase tracking-widest animate-pulse">
                          Nearly Full
                        </div>
                      )}
                    </div>
                    <button 
                      type="button" 
                      onClick={() => setCasesOnSkid(c => Math.min(casesPerSkid, c + 1))}
                      className="w-14 h-12 rounded-lg bg-muted/40 border border-border/50 text-2xl font-bold text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 select-none flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { setSkids(s => s + 1); setCasesOnSkid(0); }}
                  className="w-full h-16 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 text-xl font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(16,185,129,0.15)]"
                >
                  <CheckCircle2 className="w-7 h-7" />
                  Skid Done
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>

      <div className="mt-8">
        {/* ── Collapsed Config Chip Row ── */}
        <Card className="bg-card/40 border-border/40 shadow-none overflow-hidden">
          <button 
            className="w-full px-4 py-3 flex items-center justify-between text-left"
            onClick={() => setConfigExpanded(!configExpanded)}
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-bold text-foreground">Packaging Config</span>
            </div>
            <div className="flex items-center gap-2">
              {!configExpanded && (
                <div className="flex gap-1.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">Cartoned</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground">{v.cartonsPerCase} / case</span>
                </div>
              )}
              {configExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>
          
          {configExpanded && (
            <div className="px-4 pb-4 border-t border-border/20 pt-3 bg-card/60">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Cartons/Case</span>
                  <span className="text-sm font-mono font-bold text-foreground">{v.cartonsPerCase}</span>
                </div>
                {PACKAGING_FIELDS.filter(f => f.name !== "cartoned").map(f => (
                  <div key={f.name} className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate">{f.label}</span>
                    <span className="text-sm font-semibold text-foreground capitalize truncate" title={String(v[f.name] || "")}>
                      {v[f.name] || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

    </div>
  );
}
