import { useState } from "react";
import { AlertTriangle, CheckCircle2, Package, Sparkles, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function VariantA() {
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
    <div className="pkg-tab-scope min-h-screen bg-background text-foreground p-4 max-w-md mx-auto flex flex-col gap-4">
      {/* ── Active Run Hero (Glance Board) ── */}
      <div className="bg-card/50 border border-border/50 rounded-xl overflow-hidden shadow-lg flex flex-col">
        <div className="p-4 flex items-center justify-between bg-black/20 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${autoTrack ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {autoTrack ? "Auto-Tracking" : "Manual Tracking"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAutoTrack(a => !a)}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md border border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <Sparkles className="w-3 h-3" /> Toggle
          </button>
        </div>

        <div className="p-6 text-center space-y-4">
          <div>
            <div className="flex justify-center items-end gap-3 font-mono">
              <button 
                type="button" 
                onClick={() => setSkids(s => Math.max(0, s - 1))}
                className="w-12 h-14 rounded-lg bg-muted/40 text-xl font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mb-1 select-none"
              >
                −
              </button>
              <div className="text-7xl font-black tabular-nums tracking-tight">{skids}</div>
              <button 
                type="button" 
                onClick={() => setSkids(s => s + 1)}
                className="w-12 h-14 rounded-lg bg-muted/40 text-xl font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all mb-1 select-none"
              >
                +
              </button>
            </div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mt-1">Skids Completed</p>
          </div>

          <div className="bg-background/40 rounded-xl p-4 border border-border/50">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-bold text-muted-foreground">Cases on Skid</span>
              <div className="font-mono text-xl font-bold tabular-nums">
                <span className="text-foreground">{casesOnSkid}</span>
                <span className="text-muted-foreground">/{casesPerSkid}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                type="button" 
                onClick={() => setCasesOnSkid(c => Math.max(0, c - 1))}
                className="w-14 h-14 rounded-lg bg-muted/40 border border-border/50 text-2xl font-bold text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 select-none"
              >
                −
              </button>
              <div className="flex-1 relative h-10 bg-muted/30 rounded-md overflow-hidden border border-border/40">
                <div 
                  className="absolute inset-y-0 left-0 bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${(casesOnSkid / casesPerSkid) * 100}%` }}
                />
                {skidNearlyFull && (
                  <div className="absolute inset-0 flex items-center justify-center text-primary-foreground font-bold text-xs uppercase tracking-widest animate-pulse">
                    Nearly Full
                  </div>
                )}
              </div>
              <button 
                type="button" 
                onClick={() => setCasesOnSkid(c => Math.min(casesPerSkid, c + 1))}
                className="w-14 h-14 rounded-lg bg-muted/40 border border-border/50 text-2xl font-bold text-foreground hover:bg-muted active:scale-95 transition-all shrink-0 select-none"
              >
                +
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setSkids(s => s + 1); setCasesOnSkid(0); }}
            className="w-full h-20 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 text-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(16,185,129,0.15)]"
          >
            <CheckCircle2 className="w-8 h-8" />
            Skid Done
          </button>
        </div>

        <div className="bg-black/20 p-3 border-t border-border/50 flex items-center gap-3">
          <div className="flex-1">
            <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 bg-primary"
                style={{ width: `${fillPct * 100}%` }}
              />
            </div>
          </div>
          <p className="text-[10px] font-mono font-semibold text-muted-foreground uppercase whitespace-nowrap">
            Freezer: {String(Math.floor(fillRemain / 60)).padStart(2, "0")}:{String(fillRemain % 60).padStart(2, "0")} Rem
          </p>
        </div>
      </div>

      {/* ── Output Metrics (Rides under hero) ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/20 border border-border/30 rounded-xl p-4 text-center flex flex-col justify-center">
          <p className="text-3xl font-mono font-black tabular-nums text-emerald-400">{fmtNum(calc.casesCompleted, 0)}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">Cases Done</p>
        </div>
        <div className="bg-muted/20 border border-border/30 rounded-xl p-4 text-center flex flex-col justify-center">
          <p className="text-3xl font-mono font-black tabular-nums text-foreground">{fmtNum(calc.casesLeftToRun, 0)}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">Cases Left</p>
        </div>
        <div className="bg-muted/20 border border-border/30 rounded-xl p-4 text-center flex flex-col justify-center">
          <p className="text-3xl font-mono font-black tabular-nums text-foreground">{fmtNum(calc.casesOnLine, 0)}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">On Line</p>
        </div>
      </div>

      {/* ── Slim Amber Draining Strip ── */}
      <div className="bg-amber-950/30 border border-amber-600/30 rounded-xl p-3 flex flex-col gap-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-950">
          <div className="h-full bg-amber-500 transition-all duration-1000" style={{ width: `${dPct * 100}%` }} />
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-500">Draining Prior Run</p>
            <p className="text-sm font-semibold text-amber-100 truncate max-w-[200px]">{draining.name}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono font-bold text-amber-500">
              {String(dMm).padStart(2, "0")}:{String(dSs).padStart(2, "0")} left
            </p>
            <p className="text-xs font-bold text-amber-200">{fmtNum(dDone)} / {draining.casesNeeded} cases</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <div className="flex flex-1 items-center bg-amber-950/50 rounded-lg border border-amber-700/30">
            <button type="button" onClick={() => setDCases(c => Math.max(0, c - 1))} className="w-12 h-10 flex items-center justify-center text-amber-400 font-bold text-xl active:bg-amber-900/50 rounded-l-lg select-none">−</button>
            <div className="flex-1 text-center font-mono font-bold text-amber-100 tabular-nums">
              <span className="text-lg">{dCases}</span><span className="text-amber-500/70 text-xs">/{draining.casesPerSkid}</span>
            </div>
            <button type="button" onClick={() => setDCases(c => Math.min(draining.casesPerSkid, c + 1))} className="w-12 h-10 flex items-center justify-center text-amber-400 font-bold text-xl active:bg-amber-900/50 rounded-r-lg select-none">+</button>
          </div>
          <button
            type="button"
            onClick={() => { setDSkids(s => s + 1); setDCases(0); }}
            className="w-16 h-10 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 rounded-lg flex items-center justify-center active:scale-95 transition-all"
          >
            <CheckCircle2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1" />

      {/* ── Collapsed Config Chip Row ── */}
      <Card className="bg-card/30 border-border/40 shadow-none overflow-hidden mt-4">
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
          <div className="px-4 pb-4 border-t border-border/20 pt-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="flex justify-between items-baseline text-xs">
                <span className="text-muted-foreground">Cartons/Case</span>
                <span className="font-mono font-bold text-foreground">{v.cartonsPerCase}</span>
              </div>
              {PACKAGING_FIELDS.filter(f => f.name !== "cartoned").map(f => (
                <div key={f.name} className="flex justify-between items-baseline text-xs">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-bold text-foreground capitalize truncate max-w-[80px] text-right" title={String(v[f.name] || "")}>
                    {v[f.name] || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
