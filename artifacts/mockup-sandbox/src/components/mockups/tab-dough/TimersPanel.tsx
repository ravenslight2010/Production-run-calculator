import { useEffect, useState } from "react";
import { Gauge, Pause, RotateCcw, Timer, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import "./_group.css";

/* ── Variant B: Command Panel ──────────────────────────────────────────────
   One dedicated "Auto Dough Timers" card under the steppers: a big Next
   Batch Due countdown ring, then a row per timer showing its cadence, what
   the next tick does, and controls (Hold 1 min / Resume / Fire now).
   Cadences use the real engine math from useAutoTrack. */

const calc = { ppm: 24, perTray: 42, perBatch: 260, timePerBatchSec: 14 * 60 };

const TRAY_PERIOD_S = (calc.perTray / calc.ppm) * 60; // 105 s
const BATCH_DRAIN_S = (calc.perBatch / calc.ppm / 4) * 60; // ~162 s
const MIXER_PERIOD_S = (calc.perBatch / calc.ppm) * 60; // ~650 s
const CASE_PERIOD_S = (12 / calc.ppm) * 60; // 30 s (pizzasPerCase / ppm)

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

function CountdownRing({ secLeft, periodSec, due }: { secLeft: number; periodSec: number; due: boolean }) {
  const pct = Math.min(1, Math.max(0, 1 - secLeft / periodSec));
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" className="stroke-muted/40" />
        <circle
          cx="60" cy="60" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          className={due ? "stroke-orange-400" : "stroke-primary"}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono font-black text-2xl tabular-nums ${due ? "text-orange-400 animate-pulse" : "text-foreground"}`}>
          {due ? "GO" : fmtMS(secLeft)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
          {due ? "start batch" : "next batch"}
        </span>
      </div>
    </div>
  );
}

function TimerRow({
  icon,
  name,
  effect,
  effectColor,
  secLeft,
  periodSec,
  paused,
}: {
  icon: React.ReactNode;
  name: string;
  effect: string;
  effectColor: string;
  secLeft: number;
  periodSec: number;
  paused: boolean;
}) {
  const pct = Math.min(100, Math.max(0, (1 - secLeft / periodSec) * 100));
  return (
    <div className={`rounded-lg bg-muted/20 px-3 py-2.5 ${paused ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground truncate">{name}</p>
            <p className="text-sm font-mono font-bold tabular-nums text-foreground shrink-0">
              {paused ? "—:—" : fmtMS(secLeft)}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={`text-[10px] ${effectColor}`}>{effect}</p>
            <p className="text-[10px] text-muted-foreground font-mono shrink-0">every {fmtMS(periodSec)}</p>
          </div>
          <div className="h-1 rounded-full bg-muted/40 overflow-hidden mt-1.5">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: paused ? "0%" : `${pct}%`, transition: "width 1s linear" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TimersPanel() {
  const now = useNowSec();
  const [mountSec] = useState(() => Date.now() / 1000);
  const [cycleStart, setCycleStart] = useState(() => Date.now() / 1000);
  const elapsed = now - mountSec;

  const [suppressUntil, setSuppressUntil] = useState(0);
  const suppressed = now < suppressUntil;
  const paused = suppressed;

  /* Big ring: time until the NEXT dough batch must be started (14 min/batch) */
  const batchElapsed = now - cycleStart;
  const batchLeft = calc.timePerBatchSec - (batchElapsed % calc.timePerBatchSec);
  const batchDue = batchLeft <= 5;

  const trayLeft = TRAY_PERIOD_S - (elapsed % TRAY_PERIOD_S);
  const drainLeft = BATCH_DRAIN_S - (elapsed % BATCH_DRAIN_S);
  const mixerLeft = MIXER_PERIOD_S - (elapsed % MIXER_PERIOD_S);
  const caseLeft = CASE_PERIOD_S - (elapsed % CASE_PERIOD_S);

  return (
    <div className="dough-tab-scope dark min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Variant B · Timer command panel
        </p>

        <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden mb-4">
          <div className={`h-1 w-full ${batchDue ? "bg-orange-500" : "bg-primary"}`} />
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Timer className="w-3.5 h-3.5" /> Auto Dough Timers
              </CardTitle>
              <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                paused ? "border-amber-600/40 bg-amber-950/30 text-amber-400" : "border-primary/50 bg-primary/10 text-primary"
              }`}>
                {paused ? <Pause className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                {paused ? `Held ${fmtMS(suppressUntil - now)}` : "Tracking"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-4 mb-4">
              <CountdownRing secLeft={batchLeft} periodSec={calc.timePerBatchSec} due={batchDue && !paused} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-bold text-foreground">Next dough batch</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  One batch every <span className="font-mono text-foreground">{fmtMS(calc.timePerBatchSec)}</span> keeps
                  the line fed at <span className="font-mono text-foreground">{calc.ppm}</span> pizzas/min.
                </p>
                <button
                  type="button"
                  onClick={() => setCycleStart(Date.now() / 1000)}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors"
                >
                  <RotateCcw className="w-2.5 h-2.5" /> Batch started — restart timer
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <TimerRow
                icon={<Gauge className="w-4 h-4" />}
                name="Trays on Line"
                effect="−1 tray (line) · +1 tray (press, offset ½ cycle)"
                effectColor="text-orange-400"
                secLeft={trayLeft}
                periodSec={TRAY_PERIOD_S}
                paused={paused}
              />
              <TimerRow
                icon={<Gauge className="w-4 h-4" />}
                name="Batches Ready — drain"
                effect="−0.25 batch, shown as 1.75 → 1.50 → …"
                effectColor="text-orange-400"
                secLeft={drainLeft}
                periodSec={BATCH_DRAIN_S}
                paused={paused}
              />
              <TimerRow
                icon={<Gauge className="w-4 h-4" />}
                name="Batches Ready — mixer"
                effect="+1 batch when the mixer finishes"
                effectColor="text-emerald-400"
                secLeft={mixerLeft}
                periodSec={MIXER_PERIOD_S}
                paused={paused}
              />
              <TimerRow
                icon={<Gauge className="w-4 h-4" />}
                name="Cases / Skids"
                effect="+1 case; skid rolls when the skid fills"
                effectColor="text-sky-400"
                secLeft={caseLeft}
                periodSec={CASE_PERIOD_S}
                paused={paused}
              />
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => setSuppressUntil(Date.now() / 1000 + 60)}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md border border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <Pause className="w-3 h-3" /> Hold timers 1 min
              </button>
              <button
                type="button"
                onClick={() => setSuppressUntil(0)}
                disabled={!paused}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md border transition-colors ${
                  paused
                    ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-border bg-muted/10 text-muted-foreground/40 cursor-not-allowed"
                }`}
              >
                <Zap className="w-3 h-3" /> Resume now
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
              Editing any counter holds all timers for 1 minute automatically. Timers never overwrite your number —
              they continue forward from whatever you set.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
