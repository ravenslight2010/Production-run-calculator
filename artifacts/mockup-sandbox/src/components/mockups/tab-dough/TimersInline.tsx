import { useEffect, useState } from "react";
import { CheckCircle2, Pause, Sparkles, Timer, Zap } from "lucide-react";
import "./_group.css";

/* ── Variant A (rev 2): Inline Detail + measured mixer/hopper times ────────
   The dough steppers with live countdown strips, now driven by MEASURED
   times instead of guesses:
     • Mixer Time Low / High (seconds) — how long a batch actually spins
     • Hopper Time (seconds) — how long the hopper takes to turn one batch
       into doughballs
   Pipeline is 3 batches max: 1 prepped to spin · 1 spinning · 1 in the
   hopper being turned into doughballs. Tray cadence stays line-speed based
   (perTray / ppm). */

const calc = { ppm: 24, perTray: 42, perBatch: 260, traysNeeded: 18, batchesNeeded: 2.4 };

const TRAY_PERIOD_S = (calc.perTray / calc.ppm) * 60; // 105 s

function fmtMS(totalSec: number) {
  if (!Number.isFinite(totalSec)) return "—:—";
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
  right,
  secLeft,
  periodSec,
  color,
}: {
  label: string;
  right?: string;
  secLeft: number;
  periodSec: number;
  color: string;
}) {
  const pct = Math.min(100, Math.max(0, (1 - secLeft / periodSec) * 100));
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-[10px] font-mono font-semibold tabular-nums ${color}`}>{right ?? fmtMS(secLeft)}</span>
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

function SecondsInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="min-w-0">
      <label className="text-[10px] text-muted-foreground block truncate">{label}</label>
      <div className="flex items-center gap-1.5 mt-1">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={e => {
            const n = e.target.value === "" ? 0 : Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) onChange(n);
          }}
          onFocus={e => e.target.select()}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background/50 text-center font-mono text-sm font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="text-[9px] text-muted-foreground shrink-0">sec</span>
      </div>
      <p className="text-[9px] text-muted-foreground font-mono mt-0.5 text-center">= {fmtMS(value)}</p>
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
  onManualChange,
}: {
  label: string;
  auto?: boolean;
  value: number;
  display?: string;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  onManualChange?: () => void;
}) {
  const atMax = max !== undefined && value >= max;
  return (
    <div>
      <label className="text-xs text-muted-foreground flex items-center gap-1.5">
        {label}
        {auto && (
          <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full bg-primary/15 border border-primary/30 text-primary">
            <Zap className="w-2 h-2" /> Auto
          </span>
        )}
      </label>
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

  /* Measured machine times (seconds) — the new inputs */
  const [mixerLowSec, setMixerLowSec] = useState(480); // 8:00 fastest spin
  const [mixerHighSec, setMixerHighSec] = useState(600); // 10:00 slowest spin
  const [hopperSec, setHopperSec] = useState(650); // batch → doughballs

  const onManual = () => setSuppressUntil(Date.now() / 1000 + 60);
  const running = autoOn && !suppressed;

  /* Tray cadence still comes from line speed */
  const trayLeft = TRAY_PERIOD_S - (elapsed % TRAY_PERIOD_S);
  const trayProdLeft = TRAY_PERIOD_S - ((elapsed + TRAY_PERIOD_S / 2) % TRAY_PERIOD_S);

  /* Batch cadence now comes from the MEASURED times (all guarded ≥ 1s so a
     blank/zero input can never produce a divide-by-zero or NaN countdown).
     The simulated spin cycle runs on the HIGH time — a batch is GUARANTEED
     by the high time, and the low–high window shows when it could land. */
  const safeLow = Math.max(1, mixerLowSec);
  const safeHigh = Math.max(safeLow, Math.max(1, mixerHighSec));
  const safeHopper = Math.max(1, hopperSec);
  const drainQuarterSec = safeHopper / 4;
  const spinElapsed = elapsed % safeHigh; // simulated current spin progress
  const mixerLowLeft = Math.max(0, safeLow - spinElapsed);
  const mixerHighLeft = Math.max(0, safeHigh - spinElapsed);
  const drainLeft = drainQuarterSec - (elapsed % drainQuarterSec);
  const hopperEmptyLeft = safeHopper - (elapsed % safeHopper);

  /* Accuracy check: can the hopper keep the line fed? */
  const hopperBallsPerMin = (calc.perBatch / safeHopper) * 60;
  const hopperMargin = hopperBallsPerMin - calc.ppm;
  const hopperKeepsUp = hopperMargin >= 0;
  /* Bottleneck stage sets how often you must start a new batch */
  const bottleneckSec = Math.max(safeHigh, safeHopper);

  /* Simulated ticks so the mockup visibly moves (real app: useAutoTrack) */
  const hasDeficit = calc.traysNeeded > 0 && calc.batchesNeeded > 0;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTraysOnLine(t => Math.max(0, t - 1)), TRAY_PERIOD_S * 1000);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (!running || !hasDeficit) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const t0 = setTimeout(() => {
      setTraysOnLine(t => Math.min(74, t + 1));
      id = setInterval(() => setTraysOnLine(t => Math.min(74, t + 1)), TRAY_PERIOD_S * 1000);
    }, (TRAY_PERIOD_S / 2) * 1000);
    return () => { clearTimeout(t0); if (id) clearInterval(id); };
  }, [running, hasDeficit]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setBatchesReady(b => Math.max(0, Math.round((b - 0.25) * 100) / 100)),
      drainQuarterSec * 1000,
    );
    return () => clearInterval(id);
  }, [running, drainQuarterSec]);
  useEffect(() => {
    if (!running || !hasDeficit) return;
    // Mixer +1 lands on the same cycle the countdown window runs on (the
    // high time), so the display and the tick always agree.
    const id = setInterval(
      () => setBatchesReady(b => Math.min(3, Math.round((b + 1) * 100) / 100)),
      safeHigh * 1000,
    );
    return () => clearInterval(id);
  }, [running, hasDeficit, safeHigh]);

  return (
    <div className="dough-tab-scope dark min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Variant A · rev 2 — measured times</p>
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
            <button type="button" onClick={() => setSuppressUntil(0)} className="text-amber-400 hover:text-amber-300 font-semibold ml-2">
              Resume now
            </button>
          </div>
        )}

        {/* ── NEW: measured machine times ── */}
        <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3 mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2">
            <Timer className="w-3 h-3" /> Machine Times (measured, not guessed)
          </p>
          <div className="grid grid-cols-3 gap-2">
            <SecondsInput label="Mixer time — low" value={mixerLowSec} onChange={setMixerLowSec} />
            <SecondsInput label="Mixer time — high" value={mixerHighSec} onChange={setMixerHighSec} />
            <SecondsInput label="Hopper: batch → balls" value={hopperSec} onChange={setHopperSec} />
          </div>
          {mixerHighSec < mixerLowSec && (
            <p className="text-[10px] text-amber-400 font-semibold mt-1.5">High time should be ≥ low time</p>
          )}
        </div>

        {/* ── NEW: 3-batch pipeline ── */}
        <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3 mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Batch Pipeline · 3 max
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">1 · Prepped</p>
              <p className="text-xs font-semibold text-foreground mt-1">Waiting</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">spins when mixer frees</p>
            </div>
            <div className="bg-primary/10 rounded-lg p-2 text-center border border-primary/30">
              <p className="text-[9px] uppercase tracking-wider text-primary">2 · Spinning</p>
              <p className="text-xs font-mono font-bold text-primary mt-1 tabular-nums">
                {mixerLowLeft <= 0 ? `any sec — by ${fmtMS(mixerHighLeft)}` : `${fmtMS(mixerLowLeft)}–${fmtMS(mixerHighLeft)}`}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">until done</p>
            </div>
            <div className="bg-muted/20 rounded-lg p-2 text-center border border-orange-500/30">
              <p className="text-[9px] uppercase tracking-wider text-orange-400">3 · In Hopper</p>
              <p className="text-xs font-mono font-bold text-orange-400 mt-1 tabular-nums">{fmtMS(hopperEmptyLeft)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">until empty</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 mt-2 text-[10px] font-semibold ${hopperKeepsUp ? "text-emerald-400" : "text-amber-400"}`}>
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            {hopperKeepsUp
              ? `Hopper keeps up: ${hopperBallsPerMin.toFixed(1)} balls/min out vs ${calc.ppm} needed (+${hopperMargin.toFixed(1)})`
              : `Hopper too slow: ${hopperBallsPerMin.toFixed(1)} balls/min out vs ${calc.ppm} needed (${hopperMargin.toFixed(1)})`}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Start a new batch every <span className="font-mono text-foreground">{fmtMS(bottleneckSec)}</span> — set by the
            slowest stage ({mixerHighSec >= hopperSec ? "mixer high time" : "hopper"}).
          </p>
        </div>

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
                <Pause className="w-2.5 h-2.5" /> Timers paused
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
                <TickBar
                  label="Hopper drains ¼ batch in"
                  secLeft={drainLeft}
                  periodSec={drainQuarterSec}
                  color="text-orange-400"
                />
                <TickBar
                  label="Mixer finishes +1 in"
                  right={mixerLowLeft <= 0 ? `by ${fmtMS(mixerHighLeft)}` : `${fmtMS(mixerLowLeft)}–${fmtMS(mixerHighLeft)}`}
                  secLeft={mixerHighLeft}
                  periodSec={mixerHighSec}
                  color="text-emerald-400"
                />
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <Pause className="w-2.5 h-2.5" /> Timers paused
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> How the new formula works
          </p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Batch timing now uses <span className="text-foreground font-semibold">your measured times</span> instead of a
            guess from line speed: the mixer window ({fmtMS(mixerLowSec)}–{fmtMS(mixerHighSec)}) says when the next batch
            lands, and the hopper time ({fmtMS(hopperSec)}) sets how fast the ready batch drains (¼ every{" "}
            {fmtMS(drainQuarterSec)}). Trays still follow line speed ({calc.perTray} balls ÷ {calc.ppm}/min ={" "}
            {fmtMS(TRAY_PERIOD_S)} per tray). Any tap on a stepper still holds auto for 1 minute.
          </p>
        </div>
      </div>
    </div>
  );
}
