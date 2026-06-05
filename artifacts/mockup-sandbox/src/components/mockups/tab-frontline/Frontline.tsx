import { useState } from "react";

const APPS = [
  { label: "Sauce", type: "Tomato Basil", oz: "1.8 oz/pizza", batch: "42 lbs/barrel", color: "text-red-400", dot: "bg-red-400" },
  { label: "App 1", type: "Mozzarella Blend", oz: "3.2 oz/pizza", batch: "1.84 batches", color: "text-yellow-400", dot: "bg-yellow-400" },
  { label: "App 2", type: "Parmesan Mix", oz: "0.5 oz/pizza", batch: "0.29 batches", color: "text-yellow-300", dot: "bg-yellow-300" },
  { label: "Pep 1", type: "Pepperoni Regular", oz: "1.2 oz/pizza", batch: "68.4 lbs", color: "text-orange-400", dot: "bg-orange-400" },
];

function AppRow({ app, expanded, onToggle }: { app: typeof APPS[0]; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-zinc-800/60 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 py-3 text-left"
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${app.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{app.label}</span>
          </div>
          <p className="text-sm font-semibold text-white truncate">{app.type}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-bold tabular-nums ${app.color}`}>{app.batch}</p>
        </div>
      </button>
      {expanded && (
        <div className="pb-3 pl-5 grid grid-cols-2 gap-2">
          <div className="bg-zinc-800/50 rounded-xl px-3 py-2">
            <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Per Pizza</p>
            <p className="text-base font-bold text-white mt-0.5">{app.oz}</p>
          </div>
          <div className="bg-zinc-800/50 rounded-xl px-3 py-2">
            <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Total Needed</p>
            <p className="text-base font-bold text-white mt-0.5">{app.batch}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function Frontline() {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans px-4 py-4 max-w-[390px] mx-auto flex flex-col gap-3">

      {/* Run chip */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e]" />
          <span className="text-sm font-semibold text-zinc-300">Run 1 · 10″ Thin</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700">
          <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <span className="text-[10px] font-semibold text-zinc-400">Supervisor</span>
        </div>
      </div>

      {/* Ingredients list */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-1">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Ingredients for 480 Cases</p>
        </div>
        {APPS.map((app, i) => (
          <AppRow
            key={i}
            app={app}
            expanded={expanded === i}
            onToggle={() => setExpanded(expanded === i ? null : i)}
          />
        ))}
      </div>

      {/* Unused applicators */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Unused Slots</p>
        <div className="flex flex-wrap gap-1.5">
          {["App 3", "App 4", "Pep 2"].map(s => (
            <span key={s} className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-zinc-700 text-zinc-600">{s} — not set</span>
          ))}
        </div>
      </div>

      {/* Sauce barrel breakdown */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-3">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Sauce Barrels</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[{ label: "Full", val: "2" }, { label: "Partial", val: "1" }, { label: "Lbs in partial", val: "18.4" }].map(s => (
            <div key={s.label} className="bg-zinc-800/50 rounded-xl py-2.5">
              <p className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider">{s.label}</p>
              <p className="text-xl font-black text-white mt-0.5">{s.val}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
