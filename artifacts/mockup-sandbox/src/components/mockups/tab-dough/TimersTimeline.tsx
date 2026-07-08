import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bell, CalendarClock, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import "./_group.css";

/* ── Variant C: Timeline ───────────────────────────────────────────────────
   A "next 15 minutes" schedule of every auto tick the dough timers will
   fire: tray eaten / tray pressed / quarter-batch drained / mixer +1 /
   batch-due alert — each with its clock time and running counter value.
   Cadences use the real engine math from useAutoTrack. */

const calc = { ppm: 24, perTray: 42, perBatch: 260, timePerBatchSec: 14 * 60 };

const TRAY_PERIOD_S = (calc.perTray / calc.ppm) * 60; // 105 s
const BATCH_DRAIN_S = (calc.perBatch / calc.ppm / 4) * 60; // ~162 s
const MIXER_PERIOD_S = (calc.perBatch / calc.ppm) * 60; // ~650 s
const WINDOW_S = 15 * 60;

type Ev = {
  atSec: number;
  kind: "tray-down" | "tray-up" | "drain" | "mixer" | "batch-due";
};

function buildEvents(): Ev[] {
  const evs: Ev[] = [];
  for (let t = TRAY_PERIOD_S; t <= WINDOW_S; t += TRAY_PERIOD_S) evs.push({ atSec: t, kind: "tray-down" });
  for (let t = TRAY_PERIOD_S / 2; t <= WINDOW_S; t += TRAY_PERIOD_S) evs.push({ atSec: t, kind: "tray-up" });
  for (let t = BATCH_DRAIN_S; t <= WINDOW_S; t += BATCH_DRAIN_S) evs.push({ atSec: t, kind: "drain" });
  for (let t = MIXER_PERIOD_S; t <= WINDOW_S; t += MIXER_PERIOD_S) evs.push({ atSec: t, kind: "mixer" });
  evs.push({ atSec: calc.timePerBatchSec, kind: "batch-due" });
  return evs.sort((a, b) => a.atSec - b.atSec);
}

function fmtMS(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function clock(base: Date, plusSec: number) {
  const d = new Date(base.getTime() + plusSec * 1000);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

const KIND_META = {
  "tray-down": { label: "Line eats a tray", delta: "−1 tray", color: "text-orange-400", dot: "bg-orange-400", Icon: ArrowDown },
  "tray-up": { label: "Press finishes a tray", delta: "+1 tray", color: "text-emerald-400", dot: "bg-emerald-400", Icon: ArrowUp },
  drain: { label: "Quarter batch drained", delta: "−0.25 batch", color: "text-orange-400", dot: "bg-orange-400", Icon: ArrowDown },
  mixer: { label: "Mixer finishes a batch", delta: "+1 batch", color: "text-emerald-400", dot: "bg-emerald-400", Icon: ArrowUp },
  "batch-due": { label: "Start next dough batch", delta: "alert", color: "text-orange-400", dot: "bg-orange-500", Icon: Bell },
} as const;

export function TimersTimeline() {
  const [base] = useState(() => new Date());
  const [events] = useState(buildEvents);
  const [nowSec, setNowSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowSec((Date.now() - base.getTime()) / 1000), 1000);
    return () => clearInterval(id);
  }, [base]);

  /* Running counter projection along the timeline */
  let trays = 9;
  let batches = 1.75;
  const rows = events.map(ev => {
    if (ev.kind === "tray-down") trays = Math.max(0, trays - 1);
    if (ev.kind === "tray-up") trays = Math.min(74, trays + 1);
    if (ev.kind === "drain") batches = Math.max(0, Math.round((batches - 0.25) * 100) / 100);
    if (ev.kind === "mixer") batches = Math.min(3, batches + 1);
    return { ...ev, trays, batches: batches.toFixed(2) };
  });

  const next = rows.find(r => r.atSec > nowSec);

  return (
    <div className="dough-tab-scope dark min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Variant C · What happens next
        </p>

        <Card className="bg-card/50 border-border/50 shadow-md overflow-hidden">
          <div className="h-1 bg-primary w-full" />
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5" /> Next 15 Minutes
              </CardTitle>
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-primary/50 bg-primary/10 text-primary">
                <Zap className="w-2.5 h-2.5" /> Auto
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {next && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 mb-3">
                <p className="text-xs font-semibold text-primary truncate">
                  Next: {KIND_META[next.kind].label}
                </p>
                <p className="text-sm font-mono font-bold text-primary tabular-nums shrink-0">
                  in {fmtMS(next.atSec - nowSec)}
                </p>
              </div>
            )}

            <div className="grid grid-cols-[64px_14px_minmax(0,1fr)_88px] gap-x-2 px-1 mb-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Time</span>
              <span />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Event</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Trays · Batch</span>
            </div>

            <div className="relative">
              <div className="absolute left-[70px] top-1 bottom-1 w-px bg-border/50" />
              <div className="space-y-0.5">
                {rows.map((r, i) => {
                  const meta = KIND_META[r.kind];
                  const passed = r.atSec <= nowSec;
                  const isNext = next && r.atSec === next.atSec && r.kind === next.kind;
                  return (
                    <div
                      key={i}
                      className={`grid grid-cols-[64px_14px_minmax(0,1fr)_88px] gap-x-2 items-center py-1 px-1 rounded ${
                        isNext ? "bg-primary/10" : r.kind === "batch-due" ? "bg-orange-950/30" : ""
                      } ${passed ? "opacity-35" : ""}`}
                    >
                      <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{clock(base, r.atSec)}</span>
                      <span className={`w-2 h-2 rounded-full justify-self-center ${meta.dot} ${r.kind === "batch-due" ? "animate-pulse" : ""}`} />
                      <span className={`text-xs flex items-center gap-1 truncate ${r.kind === "batch-due" ? "font-bold " + meta.color : "text-foreground"}`}>
                        <meta.Icon className={`w-3 h-3 shrink-0 ${meta.color}`} />
                        {meta.label}
                        <span className={`font-mono text-[10px] ${meta.color}`}>{r.kind === "batch-due" ? "" : meta.delta}</span>
                      </span>
                      <span className="text-[10px] font-mono text-right text-muted-foreground tabular-nums">
                        {r.trays} · {r.batches}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
              Projected from the line speed ({calc.ppm} pizzas/min): a tray lasts {fmtMS(TRAY_PERIOD_S)}, a batch
              drains a quarter every {fmtMS(BATCH_DRAIN_S)}, and the mixer lands a fresh batch every{" "}
              {fmtMS(MIXER_PERIOD_S)}. Any manual edit re-bases the whole schedule from your numbers.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
