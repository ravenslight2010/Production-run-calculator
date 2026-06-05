import { useState } from "react";

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${muted ? "text-zinc-500" : "text-white"}`}>{value}</span>
    </div>
  );
}

export function Dough() {
  const [sub, setSub] = useState<"dough" | "crust">("dough");

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

      {/* Sub-tab toggle */}
      <div className="flex gap-1 p-1 bg-zinc-900 rounded-xl w-fit self-center border border-zinc-800">
        {(["dough", "crust"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSub(t)}
            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-colors capitalize ${sub === t ? "bg-zinc-700 text-white shadow" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {t === "dough" ? "Dough" : "Crust"}
          </button>
        ))}
      </div>

      {sub === "dough" ? (
        <>
          {/* Hero: what you need now */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-5 pt-4 pb-5">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">What You Need Now</p>
            <div className="flex items-end gap-4 mb-4">
              <div>
                <p className="text-6xl font-mono font-black text-indigo-400 leading-none">2.4</p>
                <p className="text-sm text-zinc-400 mt-1">batches to mix</p>
              </div>
              <div className="pb-1 border-l border-zinc-700 pl-4">
                <p className="text-3xl font-mono font-bold text-white leading-none">22</p>
                <p className="text-xs text-zinc-400 mt-1">trays needed</p>
              </div>
            </div>
            {/* Dough status pill */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-700/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-emerald-400">+1.8 cases ahead</span>
            </div>
          </div>

          {/* Run details */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-2">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Run Details</p>
            <Row label="Cases Left to Run" value="312" />
            <Row label="Approx. Cases on Line" value="24" />
            <Row label="Pizzas Per Minute" value="68.4" />
          </div>
        </>
      ) : (
        <>
          {/* Crust hero */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-5 pt-4 pb-5">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Crust Output</p>
            <div className="flex items-end gap-4 mb-1">
              <div>
                <p className="text-6xl font-mono font-black text-sky-400 leading-none">68.4</p>
                <p className="text-sm text-zinc-400 mt-1">pizzas per minute</p>
              </div>
            </div>
          </div>

          {/* Crust run details */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-2">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Run Details</p>
            <Row label="Cases Left to Run" value="312" />
            <Row label="Total Time Left" value="4h 32m" />
            <Row label="Cases Left to Open" value="284" />
            <Row label="Stacks Needed" value="47" />
            <Row label="Approx. Cases on Line" value="24" />
          </div>

          {/* Per-unit */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-2">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Per Unit</p>
            <Row label="Time Per Stack" value="1:24" />
            <Row label="Time Per Skid" value="28:30" />
          </div>
        </>
      )}
    </div>
  );
}
