import { useEffect, useState } from "react";
import { CheckCircle2, Pause, Sparkles, Timer, Zap } from "lucide-react";
import "./_group.css";

/* ── Variant A (rev 3): two-stage mixer + packaging quick-check ────────────
   The dough steppers with live countdown strips, driven by MEASURED times:
     • Mixer low / high speed (seconds) — SEQUENTIAL stages; total spin =
       low + high
     • Hopper time (seconds) — how long the hopper takes to turn one batch
       into doughballs
   Pipeline is 3 batches max: 1 prepped to spin · 1 spinning · 1 in the
   hopper. Batches-ready drain = slower of hopper speed and line demand.
   Tray cadence stays line-speed based (perTray / ppm). Packaging card gives
   the dough crew a skids/cases pace check without switching tabs. */

const calc = {
  ppm: 24,
  perTray: 42,
  perBatch: 260,
  traysNeeded: 18,
  batchesNeeded: 2.4,
  pizzasPerCase: 12,
  casesPerSkid: 60,
};

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

  /* Measured machine times (seconds) — the new inputs.
     The mixer runs TWO stages back-to-back: low speed, then high speed.
     Total spin time = low + high. Hopper then turns the batch into balls. */
  const [mixerLowSec, setMixerLowSec] = useState(330); // 5:30 on low speed
  const [mixerHighSec, setMixerHighSec] = useState(180); // 3:00 on high speed
  const [hopperSec, setHopperSec] = useState(70); // batch → doughballs

  const onManual = () => setSuppressUntil(Date.now() / 1000 + 60);
  const running = autoOn && !suppressed;

  /* Tray cadence still comes from line speed */
  const trayLeft = TRAY_PERIOD_S - (elapsed % TRAY_PERIOD_S);
  const trayProdLeft = TRAY_PERIOD_S - ((elapsed + TRAY_PERIOD_S / 2) % TRAY_PERIOD_S);

  /* Batch cadence comes from the MEASURED times (all guarded ≥ 1s so a
     blank/zero input can never produce a divide-by-zero or NaN countdown).
     Mixer = low stage + high stage run back-to-back; total spin = low+high. */
  const safeLow = Math.max(1, mixerLowSec);
  const safeHigh = Math.max(1, mixerHighSec);
  const safeHopper = Math.max(1, hopperSec);
  const spinTotalSec = safeLow + safeHigh;

  /* How often the LINE eats a whole batch's worth of balls */
  const lineBatchSec = (calc.perBatch / calc.ppm) * 60; // 260 ÷ 24/min = 10:50

  /* "Batches ready" can't drain faster than the line eats downstream, even
     if the hopper converts faster — so effective drain = slower of the two */
  const effDrainSec = Math.max(safeHopper, lineBatchSec);
  const drainQuarterSec = effDrainSec / 4;

  const spinElapsed = elapsed % spinTotalSec; // simulated current spin progress
  const spinLeft = spinTotalSec - spinElapsed;
  const onLowStage = spinElapsed < safeLow;
  const stageLeft = onLowStage ? safeLow - spinElapsed : spinLeft;
  const drainLeft = drainQuarterSec - (elapsed % drainQuarterSec);
  const hopperConvertLeft = safeHopper - (elapsed % safeHopper);

  /* Keep-up check: you can supply a batch every max(spin, hopper); the line
     needs one every lineBatchSec */
  const supplySec = Math.max(spinTotalSec, safeHopper);
  const keepUpMargin = lineBatchSec - supplySec;
  const keepsUp = keepUpMargin >= 0;

  /* ── Packaging quick-check (same math as the real Packaging tab) ──
     A case completes every pizzasPerCase ÷ line speed; skids roll from the
     case total. Expected pace comes from line speed; actual packed count is
     what packaging has recorded. Dough crew glances here instead of
     switching tabs. */
  const casePeriodSec = (calc.pizzasPerCase / calc.ppm) * 60; // 30 s
  const caseLeft = casePeriodSec - (elapsed % casePeriodSec);
  const expectedCasesTotal = 222 + Math.floor(elapsed / casePeriodSec);
  const [packedCasesTotal, setPackedCasesTotal] = useState(214); // simulated: a bit behind
  const packedSkids = Math.floor(packedCasesTotal / calc.casesPerSkid);
  const packedCasesOnSkid = packedCasesTotal % calc.casesPerSkid;
  const packGapCases = expectedCasesTotal - packedCasesTotal;
  const packOnPace = packGapCases <= 2;
  const packBehindSec = packGapCases * casePeriodSec;

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
    // Mixer +1 lands on the same cycle the spin countdown runs on
    // (low stage + high stage), so the display and the tick always agree.
    const id = setInterval(
      () => setBatchesReady(b => Math.min(3, Math.round((b + 1) * 100) / 100)),
      spinTotalSec * 1000,
    );
    return () => clearInterval(id);
  }, [running, hasDeficit, spinTotalSec]);
  useEffect(() => {
    // Packaging keeps recording cases at case cadence (simulated, stays a
    // constant few cases behind so the "behind" state is visible).
    const id = setInterval(() => setPackedCasesTotal(c => c + 1), casePeriodSec * 1000);
    return () => clearInterval(id);
  }, [casePeriodSec]);

  return (
    <div className="dough-tab-scope dark min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Variant A · rev 3 — two-stage mixer</p>
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
            <SecondsInput label="Mixer — low speed" value={mixerLowSec} onChange={setMixerLowSec} />
            <SecondsInput label="Mixer — high speed" value={mixerHighSec} onChange={setMixerHighSec} />
            <SecondsInput label="Hopper: batch → balls" value={hopperSec} onChange={setHopperSec} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Total spin per batch: <span className="font-mono text-foreground font-semibold">{fmtMS(spinTotalSec)}</span>{" "}
            (low {fmtMS(safeLow)} → high {fmtMS(safeHigh)}), then {fmtMS(safeHopper)} through the hopper.
          </p>
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
              <p className="text-xs font-mono font-bold text-primary mt-1 tabular-nums">{fmtMS(spinLeft)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                {onLowStage ? `low speed · ${fmtMS(stageLeft)} to high` : `high speed · ${fmtMS(stageLeft)} left`}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg p-2 text-center border border-orange-500/30">
              <p className="text-[9px] uppercase tracking-wider text-orange-400">3 · In Hopper</p>
              <p className="text-xs font-mono font-bold text-orange-400 mt-1 tabular-nums">{fmtMS(hopperConvertLeft)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">until batch is all balls</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 mt-2 text-[10px] font-semibold ${keepsUp ? "text-emerald-400" : "text-amber-400"}`}>
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            {keepsUp
              ? `Keeping up: a fresh batch every ${fmtMS(supplySec)}, line eats one every ${fmtMS(lineBatchSec)} (${fmtMS(keepUpMargin)} spare)`
              : `Falling behind: a fresh batch every ${fmtMS(supplySec)}, line eats one every ${fmtMS(lineBatchSec)} (${fmtMS(-keepUpMargin)} short)`}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Start prepping the next batch every{" "}
            <span className="font-mono text-foreground">{fmtMS(supplySec)}</span> — set by the{" "}
            {spinTotalSec >= safeHopper ? "mixer (low + high)" : "hopper"}.
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
                  label="Line uses ¼ batch in"
                  secLeft={drainLeft}
                  periodSec={drainQuarterSec}
                  color="text-orange-400"
                />
                <TickBar
                  label="Mixer finishes +1 in"
                  secLeft={spinLeft}
                  periodSec={spinTotalSec}
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

        {/* ── NEW: packaging quick-check for the dough crew ── */}
        <div className={`mt-3 rounded-lg border px-4 py-3 ${packOnPace ? "border-border/50 bg-card/50" : "border-amber-600/30 bg-amber-950/10"}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Packaging — quick check (no tab switch)
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              packOnPace
                ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/20"
                : "text-amber-400 border-amber-500/30 bg-amber-950/20"
            }`}>
              {packOnPace ? "On pace" : `Behind ${packGapCases} cases`}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Skids done</p>
              <p className="text-xl font-mono font-bold text-foreground mt-0.5 tabular-nums">{packedSkids}</p>
            </div>
            <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Cases on skid</p>
              <p className="text-xl font-mono font-bold text-foreground mt-0.5 tabular-nums">
                {packedCasesOnSkid}
                <span className="text-xs text-muted-foreground font-normal">/{calc.casesPerSkid}</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Next case in</p>
              <p className="text-xl font-mono font-bold text-orange-400 mt-0.5 tabular-nums">{fmtMS(caseLeft)}</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {packOnPace ? (
              <>Packed {packedCasesTotal} cases vs {expectedCasesTotal} expected at line speed — packaging is keeping up.</>
            ) : (
              <>
                Packed <span className="text-foreground font-semibold">{packedCasesTotal}</span> cases vs{" "}
                <span className="text-foreground font-semibold">{expectedCasesTotal}</span> expected at line speed —
                that's <span className="text-amber-400 font-semibold">{fmtMS(packBehindSec)}</span> of production not
                boxed yet. Dough keeps feeding the line either way; this is your heads-up before trays pile up at the
                wrapper.
              </>
            )}
          </p>
        </div>

        <div className="mt-3 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> How the new formula works
          </p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Batch timing now uses <span className="text-foreground font-semibold">your measured times</span>: a batch
            spins {fmtMS(safeLow)} on low + {fmtMS(safeHigh)} on high = {fmtMS(spinTotalSec)}, then takes{" "}
            {fmtMS(safeHopper)} through the hopper. Ready batches drain at the slower of hopper speed and line demand —
            here the {effDrainSec === lineBatchSec ? "line" : "hopper"} is the limit, using a batch every{" "}
            {fmtMS(effDrainSec)} (¼ every {fmtMS(drainQuarterSec)}).
            Trays still follow line speed ({calc.perTray} balls ÷ {calc.ppm}/min = {fmtMS(TRAY_PERIOD_S)} per tray). Any
            tap on a stepper still holds auto for 1 minute.
          </p>
        </div>
      </div>
    </div>
  );
}
