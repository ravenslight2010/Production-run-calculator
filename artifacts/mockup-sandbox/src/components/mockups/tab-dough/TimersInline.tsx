import { useEffect, useState } from "react";
import { AlertTriangle, Pause, Play, Sparkles, Zap } from "lucide-react";
import "./_group.css";

/* ── Variant A: Inline Detail ──────────────────────────────────────────────
   The dough steppers exactly as today, but each auto-tracked counter gets a
   live countdown strip right underneath it: when the next auto tick lands,
   what it will do (+1 from the press / −1 eaten by the line), and a thin
   progress bar filling toward the tick. Cadences use the real engine math:
   tray tick = perTray/ppm, batch drain = perBatch/ppm/4, mixer = perBatch/ppm. */

const calc = { ppm: 24, perTray: 42, perBatch: 260, traysNeeded: 18, batchesNeeded: 2.4 };

const TRAY_PERIOD_S = (calc.perTray / calc.ppm) * 60; // 105 s
const BATCH_DRAIN_S = (calc.perBatch / calc.ppm / 4) * 60; // ~162 s (quarter-batch)
const MIXER_PERIOD_S = (calc.perBatch / calc.ppm) * 60; // ~650 s

function fmtMS(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useNowSec() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function TickBar({
  label,
  secLeft,
  periodSec,
  color,
}: {
  label: string;
  secLeft: number;
  periodSec: number;
  color: string;
}) {
  const pct = Math.min(100, Math.max(0, (1 - secLeft / periodSec) * 100));
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-[10px] font-mono font-semibold tabular-nums ${color}`}>{fmtMS(secLeft)}</span>
      </div>
      <div className="h-1 rounded-full bg-muted/40 overflow-hidden mt-0.5">
        <div
          className={`h-full rounded-full ${color.replace("text-", "bg-")}`}
          style={{ width: `${pct}%`, transition: "width 1s linear" }}
        />
      </div>
    </div>
  );
}

function StepperField({
  label,
  auto,
  value,
  display,
  onChange,
  min = 0,
  max,
  suggestion,
  onSuggest,
  onManualChange,
}: {
  label: string;
  auto?: boolean;
  value: number;
  display?: string;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suggestion?: number | null;
  onSuggest?: () => void;
  onManualChange?: () => void;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted-foreground flex items-center gap-1.5">
          {label}
          {auto && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full bg-primary/15 border border-primary/30 text-primary">
              <Zap className="w-2 h-2" /> Auto
            </span>
          )}
        </label>
        {suggestion !== null && suggestion !== undefined && suggestion !== value && onSuggest && (
          <button
            type="button"
            onClick={onSuggest}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors shrink-0"
          >
            <Sparkles className="w-2.5 h-2.5" />
            Expected: {suggestion}
          </button>
        )}
      </div>
      <div className="flex items-stretch mt-1">
        <button
          type="button"
          onClick={() => { onChange(Math.max(min, value - 1)); onManualChange?.(); }}
          className="h-12 w-14 rounded-l-md border border-r-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none"
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={display ?? String(value)}
          onChange={e => {
            const n = e.target.value === "" ? 0 : Number(e.target.value);
            if (Number.isFinite(n)) { onChange(max !== undefined ? Math.min(max, n) : n); onManualChange?.(); }
          }}
          onFocus={e => e.target.select()}
          className={`h-12 flex-1 border border-input bg-background/50 text-center font-mono text-2xl font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0${atMax ? " text-amber-400" : ""}`}
        />
        <button
          type="button"
          onClick={() => { if (!atMax) { onChange(max !== undefined ? Math.min(max, value + 1) : value + 1); onManualChange?.(); } }}
          className={`h-12 w-14 rounded-r-md border border-l-0 border-input bg-muted/40 hover:bg-muted text-xl font-bold text-foreground transition-colors shrink-0 active:bg-muted/80 select-none touch-none${atMax ? " opacity-30 cursor-not-allowed" : ""}`}
          disabled={atMax}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function TimersInline() {
  const now = useNowSec();
  const [mountSec] = useState(() => Date.now() / 1000);
  const elapsed = now - mountSec;

  const [autoOn, setAutoOn] = useState(true);
  const [suppressUntil, setSuppressUntil] = useState(0);
  const suppressed = now < suppressUntil;
  const suppressedSecLeft = Math.max(0, suppressUntil - now);

  const [traysOnLine, setTraysOnLine] = useState(9);
  const [batchesReady, setBatchesReady] = useState(1.75);

  const onManual = () => setSuppressUntil(Date.now() / 1000 + 60);

  const running = autoOn && !suppressed;
  const trayLeft = TRAY_PERIOD_S - (elapsed % TRAY_PERIOD_S);
  const trayProdLeft = TRAY_PERIOD_S - ((elapsed + TRAY_PERIOD_S / 2) % TRAY_PERIOD_S);
  const drainLeft = BATCH_DRAIN_S - (elapsed % BATCH_DRAIN_S);
  const mixerLeft = MIXER_PERIOD_S - (elapsed % MIXER_PERIOD_S);

  /* Simulated ticks so the mockup visibly moves (real app: useAutoTrack).
     Mirrors the engine: consumption ticks drain, and — while the run still
     has a dough deficit — production ticks add (+1 tray from the press,
     offset half a cycle; +1 batch when the mixer finishes a full cycle). */
  const hasDeficit = calc.traysNeeded > 0 && calc.batchesNeeded > 0; // mock deficit stays open
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setTraysOnLine(t => Math.max(0, t - 1)); // line eats a tray
    }, TRAY_PERIOD_S * 1000);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (!running || !hasDeficit) return;
    // Press production: first tick lands half a period out of phase.
    let id: ReturnType<typeof setInterval> | undefined;
    const t0 = setTimeout(() => {
      setTraysOnLine(t => (t < 74 ? Math.min(74, t + 1) : t));
      id = setInterval(() => {
        setTraysOnLine(t => (t < 74 ? Math.min(74, t + 1) : t));
      }, TRAY_PERIOD_S * 1000);
    }, (TRAY_PERIOD_S / 2) * 1000);
    return () => { clearTimeout(t0); if (id) clearInterval(id); };
  }, [running, hasDeficit]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setBatchesReady(b => Math.max(0, Math.round((b - 0.25) * 100) / 100)); // quarter-batch drain
    }, BATCH_DRAIN_S * 1000);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (!running || !hasDeficit) return;
    const id = setInterval(() => {
      setBatchesReady(b => (b < 3 ? Math.min(3, Math.round((b + 1) * 100) / 100) : b)); // mixer +1
    }, MIXER_PERIOD_S * 1000);
    return () => clearInterval(id);
  }, [running, hasDeficit]);

  return (
    <div className="dough-tab-scope dark min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Variant A · Inline timer detail</p>
          <button
            type="button"
            onClick={() => setAutoOn(a => !a)}
            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${
              autoOn ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground"
            }`}
          >
            <Zap className="w-2.5 h-2.5" />
            {autoOn ? "Auto" : "Manual"}
          </button>
        </div>

        {suppressed && autoOn && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-amber-950/20 border border-amber-600/20 text-[10px] mb-2">
            <span className="text-amber-400 font-semibold">
              Manual override active · auto resumes in {fmtMS(suppressedSecLeft)}
            </span>
            <button
              type="button"
              onClick={() => setSuppressUntil(0)}
              className="text-amber-400 hover:text-amber-300 font-semibold ml-2"
            >
              Resume now
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <StepperField
              label="Total Trays on Line"
              auto={running}
              value={Math.round(traysOnLine)}
              onChange={setTraysOnLine}
              max={74}
              onManualChange={onManual}
            />
            {running ? (
              <>
                <TickBar label="Line eats 1 tray in" secLeft={trayLeft} periodSec={TRAY_PERIOD_S} color="text-orange-400" />
                <TickBar label="Press adds 1 tray in" secLeft={trayProdLeft} periodSec={TRAY_PERIOD_S} color="text-emerald-400" />
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <Pause className="w-2.5 h-2.5" /> Timers paused — counting stopped
              </p>
            )}
          </div>
          <div>
            <StepperField
              label="Batches of Dough Ready"
              auto={running}
              value={batchesReady}
              display={batchesReady.toFixed(2)}
              onChange={setBatchesReady}
              max={3}
              onManualChange={onManual}
            />
            {running ? (
              <>
                <TickBar label="Drains ¼ batch in" secLeft={drainLeft} periodSec={BATCH_DRAIN_S} color="text-orange-400" />
                <TickBar label="Mixer finishes +1 in" secLeft={mixerLeft} periodSec={MIXER_PERIOD_S} color="text-emerald-400" />
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <Pause className="w-2.5 h-2.5" /> Timers paused — counting stopped
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border/50 bg-card/50 px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">How the pace is set</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-muted/20 rounded-lg p-2">
              <p className="text-lg font-mono font-bold text-foreground tabular-nums">{fmtMS(TRAY_PERIOD_S)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">per tray · {calc.perTray} balls ÷ {calc.ppm}/min</p>
            </div>
            <div className="bg-muted/20 rounded-lg p-2">
              <p className="text-lg font-mono font-bold text-foreground tabular-nums">{fmtMS(BATCH_DRAIN_S)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">per ¼ batch drained</p>
            </div>
            <div className="bg-muted/20 rounded-lg p-2">
              <p className="text-lg font-mono font-bold text-foreground tabular-nums">{fmtMS(MIXER_PERIOD_S)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">mixer batch time</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Any tap on a stepper holds the timers for 1 minute so your correction sticks — the countdown keeps
            running quietly and picks back up from <span className="text-foreground font-semibold">your</span> number, never its own.
            If a counter is still 0 when its first tick lands, it self-fills with the suggested staging{" "}
            (<Play className="inline w-2.5 h-2.5 -mt-px" /> so a crew that never types dough counts still gets a countdown).
          </p>
        </div>
      </div>
    </div>
  );
}
