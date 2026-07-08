import { useState } from "react";
import { AlertTriangle, Clock, ClipboardList, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import "./_group.css";

/* ── Extracted from artifacts/run-calculator/src/pages/home.tsx
   (<TabsContent value="dough">) — live app state replaced with realistic
   mock values; layout, styling, and formulas preserved. ── */

function fmtNum(n: number, d = 0) {
  if (!Number.isFinite(n)) return "—";
  return Number(n.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}

/* Mock run values (in the real app these come from the run form + computeCalc) */
const calc = {
  batchesNeeded: 2.4,
  traysNeeded: 18,
  casesLeftToOpen: 42,
  stacksNeededTotal: 21,
  timePerBatchSec: 14 * 60,
  ppm: 24,
  perBatch: 260,
  perTray: 42,
};
const mockValues = {
  casesNeeded: 320,
  casesPerSkid: 48,
  pizzasPerCase: 12,
  crustsPerCase: 24,
  crustsPerStack: 40,
};
const doughRecipeRows = [
  { ingredient: "High-Gluten Flour", lbs: 250 },
  { ingredient: "Water", lbs: 150 },
  { ingredient: "Yeast", lbs: 5 },
  { ingredient: "Salt", lbs: 6 },
  { ingredient: "Soybean Oil", lbs: 10 },
  { ingredient: "Sugar", lbs: 8 },
];

function StepperField({
  label,
  value,
  onChange,
  min = 0,
  max,
  suggestion,
  onSuggest,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suggestion?: number | null;
  onSuggest?: () => void;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground">{label}</label>
        {suggestion !== null && suggestion !== undefined && suggestion !== value && onSuggest && (
          <button
            type="button"
            onClick={onSuggest}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors shrink-0"
            title={`Set to expected value: ${suggestion}`}
          >
            <Sparkles className="w-2.5 h-2.5" />
            Expected: {suggestion}
          </button>
        )}
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
            const v = e.target.value === "" ? 0 : Number(e.target.value);
            onChange(max !== undefined ? Math.min(max, v) : v);
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

function ReadOnlyRecipeCard({
  title,
  subtitle,
  recipe,
  accent,
}: {
  title: string;
  subtitle?: string;
  recipe: { ingredient: string; lbs: number }[];
  accent: string;
}) {
  const total = recipe.reduce((s, r) => s + r.lbs, 0);
  const SCALE_OPTIONS = [
    { label: "½", value: 0.5 },
    { label: "4", value: 1 },
    { label: "5", value: 1.25 },
    { label: "6", value: 1.5 },
  ];
  const [scale, setScale] = useState(1);
  return (
    <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mb-4">
      <div className={`h-1 ${accent} w-full`} />
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center gap-2 justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4" /> {title}
          </CardTitle>
          {subtitle ? (
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[55%] text-right">{subtitle}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="w-full">
          <div className="flex items-center flex-wrap gap-2 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Batch Size</span>
            <div className="flex gap-1 rounded-lg bg-muted/30 p-1">
              {SCALE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScale(opt.value)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    scale === opt.value ? "bg-orange-500 text-white" : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {scale !== 1 && <span className="text-[10px] text-muted-foreground">×{scale} — view only</span>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 mb-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ingredient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Lbs / Batch</span>
          </div>
          <div className="space-y-0.5">
            {recipe.map((r, idx) => (
              <div key={idx} className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 items-center py-1.5 px-1 rounded odd:bg-muted/20">
                <span className="text-sm text-foreground">{r.ingredient || "—"}</span>
                <span className="text-sm font-mono text-right text-foreground tabular-nums">{fmtNum(r.lbs * scale, 1)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-x-2 mt-2 pt-2 border-t border-border/30 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Total / Batch</span>
            <span className="text-xs font-mono text-right font-semibold text-foreground tabular-nums">{fmtNum(total * scale, 1)} lbs</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function to12hr(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function Current() {
  const [doughSubTab, setDoughSubTab] = useState<"dough" | "crusts">("dough");
  const [traysOnLine, setTraysOnLine] = useState(9);
  const [batchesReady, setBatchesReady] = useState(1);
  const [skidsCompleted, setSkidsCompleted] = useState(3);
  const [casesOnCurrentSkid, setCasesOnCurrentSkid] = useState(21);
  const [runToTime, setRunToTime] = useState("14:30");

  const v = { ...mockValues, traysOnLine, batchesReady, skidsCompleted, casesOnCurrentSkid };
  const suggestedTrays = 12;
  const suggestedBatches = 2;

  const nowTime = new Date();
  const target = new Date(nowTime);
  const [hrs, mins] = runToTime.split(":").map(Number);
  target.setHours(hrs, mins, 0, 0);
  if (target <= nowTime) target.setDate(target.getDate() + 1);
  const minutesAvailable = Math.max(0, (target.getTime() - nowTime.getTime()) / 60000);
  const timePerBatchMin = calc.timePerBatchSec / 60;
  const nowLabel = to12hr(
    `${String(nowTime.getHours()).padStart(2, "0")}:${String(nowTime.getMinutes()).padStart(2, "0")}`
  );

  /* Run-to-time math — dough mode (formulas copied from home.tsx) */
  const totalDoughballsNeeded = calc.ppm > 0 ? calc.ppm * minutesAvailable : 0;
  const doughOnHand = batchesReady * calc.perBatch + traysOnLine * calc.perTray;
  const doughStillNeeded = Math.max(0, totalDoughballsNeeded - doughOnHand);
  const batchesStillToMix = calc.perBatch > 0 ? doughStillNeeded / calc.perBatch : 0;
  const traysFromBatches = calc.perTray > 0 ? (batchesStillToMix * calc.perBatch) / calc.perTray : 0;
  const casesInWindow = v.pizzasPerCase > 0 ? Math.floor(totalDoughballsNeeded / v.pizzasPerCase) : 0;
  const hasOnHand = batchesReady > 0 || traysOnLine > 0;

  /* Run-to-time math — crust mode */
  const pizzasByTime = calc.ppm * minutesAvailable;
  const casesToOpenByTime = v.crustsPerCase > 0 ? Math.ceil(pizzasByTime / v.crustsPerCase) : 0;
  const stacksByTime = calc.perTray > 0 ? Math.ceil(pizzasByTime / calc.perTray) : 0;
  const stacksAlreadyOpen = traysOnLine;
  const moreStacksNeeded = Math.max(0, stacksByTime - stacksAlreadyOpen);
  const moreCasesNeeded =
    v.crustsPerCase > 0 && v.crustsPerStack > 0
      ? Math.max(0, casesToOpenByTime - Math.floor((stacksAlreadyOpen * v.crustsPerStack) / v.crustsPerCase))
      : casesToOpenByTime;
  const hasAlreadyOpen = stacksAlreadyOpen > 0;

  return (
    <div className="dough-tab-scope dark min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Dough / Crusts sub-tab toggle (lives in the tab header in the app) */}
        <div className="flex gap-1 p-1 bg-muted/40 border border-border/50 rounded-lg w-fit mb-4">
          {(["dough", "crusts"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setDoughSubTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                doughSubTab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "dough" ? "Dough" : "Crusts"}
            </button>
          ))}
        </div>

        {/* Supply progress steppers */}
        <div className="mb-4">
          <div className={doughSubTab !== "crusts" ? "grid grid-cols-2 gap-2" : ""}>
            <div>
              <StepperField
                label={doughSubTab === "crusts" ? "Total Stacks Ready" : "Total Trays on Line"}
                value={traysOnLine}
                onChange={setTraysOnLine}
                max={74}
                suggestion={suggestedTrays}
                onSuggest={() => setTraysOnLine(suggestedTrays)}
              />
              {traysOnLine >= 74 && doughSubTab !== "crusts" && (
                <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> Line full — max 74 trays
                </p>
              )}
            </div>
            {doughSubTab !== "crusts" && (
              <div>
                <StepperField
                  label="Batches of Dough Ready"
                  value={batchesReady}
                  onChange={setBatchesReady}
                  max={3}
                  suggestion={suggestedBatches}
                  onSuggest={() => setBatchesReady(suggestedBatches)}
                />
                {batchesReady >= 3 && (
                  <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> Max 3 batches — avoid over-mixing
                  </p>
                )}
              </div>
            )}
          </div>
          {/* Skids / cases completed — mirrored from Packaging */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <StepperField
              label="Total Skids Completed"
              value={skidsCompleted}
              onChange={setSkidsCompleted}
              max={v.casesPerSkid > 0 ? Math.floor(v.casesNeeded / v.casesPerSkid) : undefined}
            />
            <StepperField
              label="Cases on Current Skid"
              value={casesOnCurrentSkid}
              onChange={setCasesOnCurrentSkid}
              max={v.casesPerSkid > 0 ? v.casesPerSkid : undefined}
            />
          </div>
        </div>

        {/* ── Crust run ── */}
        {doughSubTab === "crusts" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
              <div className="h-1 bg-sky-500 w-full" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  What You Need Now
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <p className="text-3xl font-mono font-bold text-sky-400 tabular-nums">{fmtNum(calc.casesLeftToOpen, 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Cases to open</p>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <p className="text-3xl font-mono font-bold tabular-nums">{fmtNum(calc.stacksNeededTotal, 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Stacks to stage</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Dough run ── */}
        {doughSubTab === "dough" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
              <div className="h-1 bg-primary w-full" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  What You Need Now
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <p className="text-3xl font-mono font-bold text-primary tabular-nums">{fmtNum(calc.batchesNeeded, 2)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Batches to mix</p>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <p className="text-3xl font-mono font-bold tabular-nums">{fmtNum(calc.traysNeeded, 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Trays needed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Run to Time card — dough mode */}
        {doughSubTab === "dough" && (
          <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mt-0 mb-4">
            <div className="h-1 bg-amber-500 w-full" />
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Run to Time
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs text-muted-foreground shrink-0">{nowLabel}</span>
                <span className="text-xs text-muted-foreground shrink-0">→ run until</span>
                <input
                  type="time"
                  value={runToTime}
                  onChange={e => setRunToTime(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <span className="text-xs text-muted-foreground shrink-0 font-mono">{fmtNum(timePerBatchMin, 1)} min/batch</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-amber-400">
                    {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}
                    {Math.round(minutesAvailable % 60)}m
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Time available</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-primary">{fmtNum(batchesStillToMix, 2)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Batches to mix</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-emerald-400">{Math.ceil(traysFromBatches)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Trays to make</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-sky-400">{casesInWindow}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Cases in window</p>
                </div>
              </div>
              {hasOnHand && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  {[
                    batchesReady > 0 && `${batchesReady} batch${batchesReady !== 1 ? "es" : ""} ready`,
                    traysOnLine > 0 && `${traysOnLine} tray${traysOnLine !== 1 ? "s" : ""} on line`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  already on hand — subtracted from totals
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Run to Time card — crust mode */}
        {doughSubTab === "crusts" && (
          <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mt-0 mb-4">
            <div className="h-1 bg-sky-500 w-full" />
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Run to Time
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs text-muted-foreground shrink-0">{nowLabel}</span>
                <span className="text-xs text-muted-foreground shrink-0">→ run until</span>
                <input
                  type="time"
                  value={runToTime}
                  onChange={e => setRunToTime(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-amber-400">
                    {Math.floor(minutesAvailable / 60) > 0 && `${Math.floor(minutesAvailable / 60)}h `}
                    {Math.round(minutesAvailable % 60)}m
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Time available</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-sky-400">{casesToOpenByTime}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{hasAlreadyOpen ? "Cases total" : "Cases to open"}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-primary">{stacksByTime}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{hasAlreadyOpen ? "Stacks total" : "Stacks to stage"}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-2 text-center">
                  <p className="text-xl font-mono font-bold text-emerald-400">{moreStacksNeeded}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">More stacks needed</p>
                </div>
              </div>
              {hasAlreadyOpen && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  {stacksAlreadyOpen} stack{stacksAlreadyOpen !== 1 ? "s" : ""} already open — subtracted from totals
                  {moreCasesNeeded > 0 && ` · open ${moreCasesNeeded} more case${moreCasesNeeded !== 1 ? "s" : ""}`}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dough recipe (read-only view) */}
        {doughSubTab === "dough" && (
          <ReadOnlyRecipeCard
            title="Dough Recipe"
            subtitle="House Thin Crust"
            recipe={doughRecipeRows}
            accent="bg-orange-500/70"
          />
        )}
      </div>
    </div>
  );
}
