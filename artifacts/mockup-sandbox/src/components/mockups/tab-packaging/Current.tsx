import { useState } from "react";
import { AlertTriangle, CheckCircle2, Package, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import "./_group.css";

/* ── Extracted from artifacts/run-calculator/src/pages/home.tsx
   (<TabsContent value="packaging">) — live app state replaced with realistic
   mock values; layout, styling, and formulas preserved. ── */

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

/* Mock run values (in the real app these come from the run form + computeCalc) */
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
/* Mock: a just-ended prior run still draining out of the freezer */
const draining = {
  name: "Lucia – Pepperoni",
  skids: 5,
  casesOnSkid: 39,
  casesPerSkid: 42,
  casesNeeded: 260,
  remainSecs: 11 * 60 + 24,
  totalSecs: 45 * 60,
};

function StepperField({
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
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground">{label}</label>
      </div>
      <div className="flex items-stretch mt-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={e => {
            const nv = e.target.value === "" ? 0 : Number(e.target.value);
            onChange(max !== undefined ? Math.min(max, nv) : nv);
          }}
          onFocus={e => e.target.select()}
          className={`h-12 flex-1 border border-input bg-background/50 text-center font-mono text-2xl font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0${atMax ? " text-amber-400" : ""}`}
        />
        <button
          type="button"
          onClick={() => { if (!atMax) onChange(max !== undefined ? Math.min(max, value + 1) : value + 1); }}
          className={`h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}
          disabled={atMax}
        >
          +
        </button>
      </div>
    </div>
  );
}

function MiniStepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onDec}
          className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
        >
          −
        </button>
        <div className="flex-1 h-12 border-y border-input bg-background flex items-center justify-center text-lg font-mono font-bold tabular-nums text-foreground">
          {value}
        </div>
        <button
          type="button"
          onClick={onInc}
          className="h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Current() {
  const [skids, setSkids] = useState(4);
  const [casesOnSkid, setCasesOnSkid] = useState(21);
  const [autoTrack, setAutoTrack] = useState(true);
  const [dSkids, setDSkids] = useState(draining.skids);
  const [dCases, setDCases] = useState(draining.casesOnSkid);

  const casesPerSkid = Number(v.casesPerSkid);
  const casesNeeded = Number(v.casesNeeded);
  const maxSkids = casesPerSkid > 0 ? Math.floor(casesNeeded / casesPerSkid) : undefined;
  const skidNearlyFull =
    casesPerSkid > 0 && casesOnSkid > 0 &&
    casesOnSkid >= casesPerSkid - 3 && casesOnSkid < casesPerSkid;

  /* Draining-card derived values */
  const dDone = dSkids * draining.casesPerSkid + dCases;
  const dLeft = Math.max(0, draining.casesNeeded - dDone);
  const dPct = Math.min(1 - draining.remainSecs / draining.totalSecs, 1);
  const dMm = Math.floor(draining.remainSecs / 60);
  const dSs = draining.remainSecs % 60;
  const dNearlyFull =
    dCases > 0 && dCases >= draining.casesPerSkid - 3 && dCases < draining.casesPerSkid;

  /* Freezer filling (active run) — mock 08:42 remaining of 25:00 */
  const fillTotal = 25 * 60;
  const fillRemain = 8 * 60 + 42;
  const fillPct = Math.min((fillTotal - fillRemain) / fillTotal, 1);

  return (
    <div className="pkg-tab-scope min-h-screen bg-background text-foreground p-4 max-w-md mx-auto">
      {/* ── Packaging config summary ── */}
      <Card className="bg-card/50 border-border/50 shadow-md mb-4">
        <CardHeader className="pb-1 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Packaging
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <span className="inline-block mb-3 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border bg-primary/15 text-primary border-primary/40">
            Cartoned
          </span>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Cartons / Case</span>
              <span className="font-bold tabular-nums text-foreground whitespace-nowrap">
                {fmtNum(Number(v.cartonsPerCase), 0)}
              </span>
            </div>
            {PACKAGING_FIELDS.filter(f => f.name !== "cartoned").map(f => {
              const val = String(v[f.name] ?? "").trim();
              return (
                <div key={f.name} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-bold tabular-nums text-foreground capitalize whitespace-nowrap">
                    {val || "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Finishing — Freezer Draining (just-ended run still exiting freezer) ── */}
      <Card className="bg-amber-950/10 border-amber-600/40 shadow-md mb-4">
        <CardHeader className="pb-1 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            Finishing — Freezer Draining
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <p className="text-base font-semibold text-foreground truncate">{draining.name}</p>
          <p className="text-xs text-muted-foreground">
            Finished pizzas are still exiting the freezer. Log skids &amp; cases as they come off.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <MiniStepper
              label="Total Skids Completed"
              value={dSkids}
              onDec={() => setDSkids(s => Math.max(0, s - 1))}
              onInc={() => setDSkids(s => s + 1)}
            />
            <MiniStepper
              label="Cases on Current Skid"
              value={dCases}
              onDec={() => setDCases(c => Math.max(0, c - 1))}
              onInc={() => setDCases(c => Math.min(draining.casesPerSkid, c + 1))}
            />
          </div>
          {dNearlyFull && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-600/30 text-amber-400 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Skid nearly full — {draining.casesPerSkid - dCases} case{draining.casesPerSkid - dCases !== 1 ? "s" : ""} to go
            </div>
          )}
          <button
            type="button"
            onClick={() => { setDSkids(s => s + 1); setDCases(0); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 text-sm font-semibold transition-colors active:scale-[0.98]"
          >
            <CheckCircle2 className="w-4 h-4" />
            Skid Done — log &amp; reset
          </button>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-mono font-bold tabular-nums text-emerald-400">{fmtNum(dDone, 0)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Cases done</p>
            </div>
            <div className="bg-muted/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-mono font-bold tabular-nums">{fmtNum(dLeft, 0)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Cases left</p>
            </div>
          </div>
          <Separator className="opacity-30 my-1" />
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Freezer Emptying</p>
            <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 bg-amber-500"
                style={{ width: `${dPct * 100}%` }}
              />
            </div>
            <p className="text-[10px] font-mono font-semibold text-right text-amber-400">
              {`Draining — ${String(dMm).padStart(2, "0")}:${String(dSs).padStart(2, "0")} left`}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Current Progress ── */}
      <Card className="bg-card/50 border-border/50 shadow-md mb-4">
        <CardHeader className="pb-1 pt-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Current Progress
            </CardTitle>
            <button
              type="button"
              onClick={() => setAutoTrack(a => !a)}
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${autoTrack ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground"}`}
            >
              <Sparkles className="w-2.5 h-2.5" />
              {autoTrack ? "Auto" : "Manual"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <StepperField
              label={autoTrack ? "Total Skids Completed · Auto" : "Total Skids Completed"}
              value={skids}
              onChange={setSkids}
              max={maxSkids}
            />
            <StepperField
              label={autoTrack ? "Cases on Current Skid · Auto" : "Cases on Current Skid"}
              value={casesOnSkid}
              onChange={setCasesOnSkid}
              max={casesPerSkid > 0 ? casesPerSkid : undefined}
            />
          </div>
          {skidNearlyFull && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-600/30 text-amber-400 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Skid nearly full — {casesPerSkid - casesOnSkid} case{casesPerSkid - casesOnSkid !== 1 ? "s" : ""} to go
            </div>
          )}
          <button
            type="button"
            onClick={() => { setSkids(s => s + 1); setCasesOnSkid(0); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-400 text-sm font-semibold transition-colors active:scale-[0.98]"
          >
            <CheckCircle2 className="w-4 h-4" />
            Skid Done — log &amp; reset
          </button>
          <Separator className="opacity-30 my-1" />
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Freezer Filling</p>
            <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 bg-primary"
                style={{ width: `${fillPct * 100}%` }}
              />
            </div>
            <p className="text-[10px] font-mono font-semibold text-right text-muted-foreground">
              {`${String(Math.floor(fillRemain / 60)).padStart(2, "0")}:${String(fillRemain % 60).padStart(2, "0")} remaining`}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Output metrics ── */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-3xl font-mono font-bold tabular-nums text-emerald-400">{fmtNum(calc.casesCompleted, 0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Cases done</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-3xl font-mono font-bold tabular-nums">{fmtNum(calc.casesLeftToRun, 0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Cases left</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-3xl font-mono font-bold tabular-nums">{fmtNum(calc.casesOnLine, 0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">On line</p>
        </div>
      </div>
      {calc.extraCases > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-700/40 bg-emerald-950/30 p-3 text-center">
          <p className="text-3xl font-mono font-bold tabular-nums text-emerald-400">+{fmtNum(calc.extraCases, 0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Extra cases beyond target</p>
        </div>
      )}
    </div>
  );
}
