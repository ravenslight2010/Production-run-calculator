import { useState } from "react";

const RUNS = [
  { label: "Run 1 — Classic Thin", die: "10″ Thin", status: "finished", cases: 480, planned: 480, time: "7:12:00", ppm: 71, downtime: "12:30", start: "06:00", end: "13:12" },
  { label: "Run 2 — Rising Crust", die: "10″ Rising", status: "current", cases: 168, planned: 420, time: "—", ppm: 68, downtime: "0:00", start: "13:20", end: null },
  { label: "Run 3 — Thin Pepperoni", die: "12″ Thin", status: "upcoming", cases: 0, planned: 360, time: "—", ppm: null, downtime: "—", start: null, end: null },
];

function RunCard({ run }: { run: typeof RUNS[0] }) {
  const isFinished = run.status === "finished";
  const isCurrent = run.status === "current";
  const pct = run.planned > 0 ? Math.min(1, run.cases / run.planned) : 0;

  return (
    <div className={`rounded-2xl border px-4 pt-3 pb-4 ${
      isCurrent ? "bg-indigo-950/30 border-indigo-700/40"
      : isFinished ? "bg-emerald-950/20 border-emerald-700/30"
      : "bg-zinc-900 border-zinc-800"
    }`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-bold text-white">{run.label}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {run.die && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-semibold">{run.die}</span>}
            {run.start && <span className="text-[10px] text-zinc-500">{run.start}{run.end ? ` → ${run.end}` : " → running"}</span>}
          </div>
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          isCurrent ? "bg-indigo-600/30 text-indigo-400"
          : isFinished ? "bg-emerald-700/30 text-emerald-400"
          : "bg-zinc-800 text-zinc-500"
        }`}>
          {run.status}
        </span>
      </div>

      {/* Cases progress */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-zinc-900/80 rounded-xl py-2 text-center border border-zinc-800/60">
          <p className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider">Cases</p>
          <p className="text-lg font-black tabular-nums">{run.cases > 0 ? run.cases.toLocaleString() : "—"}</p>
        </div>
        <div className="bg-zinc-900/80 rounded-xl py-2 text-center border border-zinc-800/60">
          <p className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider">Planned</p>
          <p className="text-lg font-black tabular-nums">{run.planned.toLocaleString()}</p>
        </div>
        <div className="bg-zinc-900/80 rounded-xl py-2 text-center border border-zinc-800/60">
          <p className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider">PPM</p>
          <p className={`text-lg font-black tabular-nums ${run.ppm ? (run.ppm >= 68 ? "text-emerald-400" : "text-orange-400") : "text-zinc-600"}`}>{run.ppm ?? "—"}</p>
        </div>
      </div>

      {/* Progress bar */}
      {(isCurrent || isFinished) && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-zinc-500 font-semibold">
            <span>{run.cases} / {run.planned} cases</span>
            <span>{Math.round(pct * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: isFinished ? "#22c55e" : "#6366f1" }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Summary() {
  const [notes, setNotes] = useState("Line running well. Freezer temp holding steady.");

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans px-4 py-4 max-w-[390px] mx-auto flex flex-col gap-3">

      {/* Run chip */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-zinc-300">Today's Shift</span>
        <span className="text-xs text-zinc-500">3 runs</span>
      </div>

      {/* Shift stats */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-zinc-800">
          {[
            { label: "Cases Made", val: "648", color: "text-white" },
            { label: "Net Run Time", val: "10:44", color: "text-white" },
            { label: "Downtime", val: "12:30", color: "text-orange-400" },
            { label: "Today PPM", val: "70", sub: "▲ +2 vs avg", color: "text-emerald-400" },
          ].map(s => (
            <div key={s.label} className="px-4 py-3">
              <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-widest">{s.label}</p>
              <p className={`text-2xl font-black tabular-nums mt-0.5 ${s.color}`}>{s.val}</p>
              {s.sub && <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">{s.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Runs */}
      {RUNS.map((r, i) => <RunCard key={i} run={r} />)}

      {/* Shift notes */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-3 pb-4">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Shift Notes</p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Handoff notes, issues, observations…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white resize-none outline-none focus:border-indigo-500 placeholder:text-zinc-600"
        />
      </div>

    </div>
  );
}
