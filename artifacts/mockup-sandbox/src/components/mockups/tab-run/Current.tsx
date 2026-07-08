import {
  History,
  Timer,
  Pause,
  Square,
  OctagonX,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import "./_group.css";

/* ── Extracted from artifacts/run-calculator/src/pages/home.tsx
   (Current Run selector card + <TabsContent value="run">) — live app state
   replaced with realistic mock values; layout, styling, and formulas
   preserved. ── */

function fmtNum(n: number, d = 0) {
  if (!Number.isFinite(n)) return "—";
  return Number(n.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}
function fmtComma(n: number) {
  return Math.round(n).toLocaleString();
}

const noop = () => {};

/* Inline StatRow — mirrors the app's helper: flex justify-between row, muted
   label, semibold tabular value; `highlight` renders a primary-colored value. */
function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

/* Mock mid-run state */
const currentRun = { brand: "Cornerbooth", flavor: "Pepperoni" };
const v = {
  casesNeeded: 850,
  dieType: "TX-16",
};
const calc = {
  casesCompleted: 314,
};
const lastRunRecall = {
  date: "6/24",
  actualCases: 830,
  wasteLbs: 12.5,
};
const nextRunDieType = "RD-12";

export function Current() {
  return (
    <div className="run-tab-scope min-h-screen bg-background text-foreground p-4">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* ─── RUN SELECTOR ─── */}
        <div className="print:hidden flex justify-center">
          {/* Current run — brand + flavor pickers */}
          <div className="flex flex-col items-center gap-2 px-4 py-2 rounded-lg bg-primary/15 border border-primary/30 w-full max-w-lg">
            <div className="text-[9px] uppercase tracking-widest text-primary/70 font-semibold">Current Run</div>
            <div className="flex items-center gap-2">

              {/* Brand picker */}
              <div className="relative">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-0.5 text-center">Brand</div>
                <div className="relative">
                  <input
                    value={currentRun.brand}
                    placeholder="Brand…"
                    className="w-28 bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-semibold text-center outline-none focus:border-primary cursor-pointer"
                    readOnly
                    onClick={noop}
                    onChange={noop}
                  />
                </div>
              </div>

              <div className="text-muted-foreground/40 text-lg font-light">–</div>

              {/* Flavor picker */}
              <div className="relative">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-0.5 text-center">Flavor</div>
                <div className="relative">
                  <input
                    value={currentRun.flavor}
                    placeholder="Flavor…"
                    className="w-28 bg-background/60 border border-border/60 rounded px-2 py-1 text-sm font-semibold text-center outline-none focus:border-primary cursor-pointer"
                    readOnly
                    onClick={noop}
                    onChange={noop}
                  />
                </div>
              </div>

            </div>

            {/* Cases Needed — editable by all, plain input outside Form context */}
            <div className="px-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Cases Needed</label>
              <input
                type="number"
                min="0"
                step="1"
                value={v.casesNeeded}
                onChange={noop}
                placeholder="0"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* Last-run recall hint */}
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/70 -mt-1">
              <History className="w-3 h-3 shrink-0" />
              <span>
                Last ran {lastRunRecall.date}
                <span> · <span className="font-semibold text-muted-foreground">{fmtComma(lastRunRecall.actualCases)} cases</span></span>
                <span> · <span className="text-amber-400/80">{fmtNum(lastRunRecall.wasteLbs, 1)} lbs waste</span></span>
              </span>
            </div>

            {/* Run status + Start/End buttons */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                <span className="hidden sm:inline">Running</span>
                <span className="text-green-400/70 font-normal hidden sm:inline">· 2h 14m</span>
              </span>
              <button
                type="button"
                onClick={noop}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-orange-700/60 text-orange-400 hover:bg-orange-950/40 text-xs font-semibold transition-colors"
              >
                <OctagonX className="w-3 h-3" /> <span className="hidden sm:inline">Log Stop</span>
              </button>
              <button
                type="button"
                onClick={noop}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
              >
                <Pause className="w-3 h-3 fill-current" /> <span className="hidden sm:inline">Pause</span>
              </button>
              <button
                type="button"
                onClick={noop}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
              >
                <Square className="w-3 h-3 fill-current" /> <span className="hidden sm:inline">Stop Run</span>
              </button>
              {/* Die type badge in run header */}
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 border border-border/50 text-muted-foreground tabular-nums">
                {v.dieType}
              </span>
            </div>

            {/* Glanceable case progress — persistent across tabs, mirrors mobile control-bar KPI */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-sm font-bold font-mono tabular-nums text-foreground shrink-0">
                {fmtComma(calc.casesCompleted)}
                <span className="text-muted-foreground">/{fmtComma(v.casesNeeded)}</span>
              </span>
              <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-primary shrink-0 tabular-nums">
                {Math.round(Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100))}%
              </span>
            </div>

            {/* Estimated time to finish — shown while running or paused */}
            <div className="flex flex-col items-center gap-1 py-1.5">
              <div className="flex items-center gap-2">
                <Timer className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Est. finish in</span>
                <span className="text-sm font-bold tabular-nums text-foreground">1h 52m</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-sm font-bold tabular-nums text-foreground">4:37 PM</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                <span>▼</span>
                <span>8m behind original estimate</span>
              </div>
            </div>

            {/* Pace gauge + PPM */}
            <div className="flex flex-wrap items-center justify-center gap-2 py-1.5 px-4 rounded-lg text-xs font-semibold bg-red-950/40 border border-red-700/30 text-red-400">
              <span>▼ 12 cases behind</span>
              <span className="opacity-60 border-l border-current/30 pl-2 ml-0.5">
                4.2 PPM
              </span>
              <span className="border-l border-current/30 pl-2 ml-0.5 text-red-300 font-bold">
                Need 4.8 PPM to finish on time
              </span>
              <span className="border-l border-current/30 pl-2 ml-0.5 text-red-300">
                ↓ 06:40 downtime
              </span>
            </div>

            {/* Run position dots */}
            <div className="flex items-center justify-center gap-1.5 py-1">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={noop}
                  className={`rounded-full transition-all ${i === 1 ? "w-4 h-2 bg-primary" : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
                />
              ))}
            </div>

            {/* Navigation row: Previous · count · New Run · Upcoming */}
            <div className="flex items-center justify-between w-full gap-1 pt-1 border-t border-primary/20">
              {/* Previous */}
              <button
                type="button"
                onClick={noop}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0"
              >
                <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                <div className="text-left min-w-0">
                  <div className="text-[8px] uppercase tracking-widest opacity-50 font-semibold leading-none mb-0.5">Prev</div>
                  <div className="font-medium text-xs truncate max-w-[90px]">Aldo's – Cheese</div>
                </div>
              </button>

              {/* Upcoming */}
              <button
                type="button"
                onClick={noop}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors min-w-0"
              >
                <div className="text-right min-w-0">
                  <div className="text-[8px] uppercase tracking-widest opacity-50 font-semibold leading-none mb-0.5">Next</div>
                  <div className="font-medium text-xs truncate max-w-[90px]">Cornerbooth – Sausage</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              </button>

              {/* Count + Run actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">4/8</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── RUN TAB ─── */}
        <div>
          {/* Freezer status — filling at run start */}
          <div className="mb-4 rounded-lg border overflow-hidden">
            <div className="flex items-start gap-2.5 px-4 py-3 bg-sky-950/30 border-sky-700/30">
              <Timer className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-sky-400">
                  Freezer filling — first cases exit in 07:12
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Product is still travelling the 35 min freezer tunnel — the completed count starts climbing once it clears.
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000 bg-sky-500"
                    style={{ width: "20%" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Die change warning — before run ends */}
          <div className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-amber-950/30 border border-amber-600/40">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-400">Die change required for next run</p>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Current: <span className="font-semibold">{v.dieType}</span>
                {" → "}
                Next: <span className="font-semibold">{nextRunDieType}</span>
                {" — prepare changeover before ending this run."}
              </p>
            </div>
          </div>

          {/* Case completion progress bar */}
          <div className="mb-4 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Cases completed</span>
              <span className="font-semibold tabular-nums text-foreground">
                {fmtComma(calc.casesCompleted)} / {fmtComma(v.casesNeeded)}
                {" "}
                <span className="text-muted-foreground">({Math.round(calc.casesCompleted / v.casesNeeded * 100)}%)</span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-primary/70"
                style={{ width: `${Math.min(100, (calc.casesCompleted / v.casesNeeded) * 100)}%` }}
              />
            </div>
          </div>

          {/* Run Details (dough variant) */}
          <Card className="bg-card/50 border-border/50 shadow-md mt-4">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Run Details
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <StatRow label="Cases Left to Run" value="536" testId="output-dough-cases-left" />
              <StatRow label="Approx. Cases on Line" value="27" testId="output-cases-on-line" />
              <div className="flex items-center justify-between py-1.5" data-testid="output-dough-status">
                <span className="text-sm text-muted-foreground">Dough Status</span>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400">
                  <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                  +3.5 cases ahead
                </span>
              </div>
              <StatRow label="Cases on Last Skid" value="14" testId="output-last-skid-cases" />
              <Separator className="my-3 opacity-30" />
              <StatRow label="Trays Per Skid" value="6.25" testId="output-trays-per-skid" />
              <StatRow label="Trays Per Batch" value="4.10" testId="output-trays-per-batch" />
              <StatRow label="Batches Per Skid" value="1.52" testId="output-batches-per-skid" />
            </CardContent>
          </Card>

          {/* Temporary adjustments — this-run-only overrides of Setup values */}
          <Card className="mt-4 bg-card/50 border-dashed border-border/70 shadow-md">
            <CardContent className="pt-4 pb-4 px-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Temporary Adjustments</p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                For this run only — leave at 0 to use the Setup value. Setup stays unchanged.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Freezer Time (setup: 35)</label>
                  <input
                    type="number"
                    step="1"
                    value={0}
                    onChange={noop}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Crusts / Cycle</label>
                  <input
                    type="number"
                    step="1"
                    value={0}
                    onChange={noop}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Cycle Speed</label>
                  <input
                    type="number"
                    step="0.1"
                    value={0}
                    onChange={noop}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming runs */}
          <div className="mt-4 rounded-xl border border-border/40 bg-card/50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Upcoming Runs</p>
            <div className="space-y-2">
              {["Cornerbooth – Sausage", "Aldo's – Supreme"].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={noop}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors text-left"
                >
                  <span className="text-sm font-medium text-foreground truncate">{label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
