import { useState } from "react";

function Row({ label, value, highlight, status }: { label: string; value: string; highlight?: boolean; status?: "ok" | "warn" | "danger" }) {
  const valColor = status === "ok" ? "text-emerald-400" : status === "warn" ? "text-orange-400" : status === "danger" ? "text-red-400" : highlight ? "text-white font-bold" : "text-zinc-300";
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className={`text-sm tabular-nums font-semibold ${valColor}`}>{value}</span>
    </div>
  );
}

export function Timing() {
  const [rackOpen, setRackOpen] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans px-4 py-4 max-w-[390px] mx-auto flex flex-col gap-3">

      {/* Run chip */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e]" />
          <span className="text-sm font-semibold text-zinc-300">Run 1 · 10″ Thin</span>
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">08:14 elapsed</span>
      </div>

      {/* Hero: time left */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-5 pt-4 pb-5">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Total Time Left</p>
        <p className="text-6xl font-mono font-black text-indigo-400 leading-none mb-3">4:32:15</p>

        {/* Status chips */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/40 border border-emerald-700/30">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">Dough covered</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700">
            <span className="text-xs font-semibold text-zinc-300">Freezer 34 / 45 min</span>
          </div>
        </div>
      </div>

      {/* Dough/freezer breakdown */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Dough Timing</p>
        <Row label="Time for Dough to Clear" value="3:10:00" />
        <Row label="Dough Runs Out In" value="5:01:00" status="ok" />
        <Row label="Pizzas Per Minute" value="68.4" />
        <Row label="Freezer Time" value="34.0 min" />
      </div>

      {/* Per unit times */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Per Unit</p>
        <Row label="Time Per Press Cycle" value="0.24s" />
        <Row label="Time Per Tray" value="1:52" />
        <Row label="Time Per Batch" value="45:10 · next at 9:02" />
        <Row label="Time Per Skid" value="28:30" highlight />
      </div>

      {/* Rack times — collapsible */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
        <button
          onClick={() => setRackOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Rack Times</p>
          <svg className={`w-4 h-4 text-zinc-500 transition-transform ${rackOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {rackOpen && (
          <div className="px-4 pb-3 border-t border-zinc-800/60">
            {[16, 20, 24].map(n => (
              <Row key={n} label={`${n}-Tray Rack`} value={`${Math.round(n * 1.88)}:00 · at ${8 + Math.floor(n / 12)}:${String((n * 3) % 60).padStart(2,"0")}`} />
            ))}
          </div>
        )}
      </div>

      {/* Stoppages summary */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Downtime</p>
          <span className="text-xs font-semibold text-orange-400">2 stops · 12:30 total</span>
        </div>
      </div>
    </div>
  );
}
