import { useState } from "react";

const ORANGE = "#f97316";
const GREEN = "#22c55e";

function Stepper({
  label,
  value,
  onChange,
  max,
  badge,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
  badge?: string;
}) {
  const pct = max && max > 0 ? Math.min(1, value / max) : null;
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</span>
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/20">
              {badge}
            </span>
          )}
        </div>
        {pct !== null && (
          <div className="mt-1 h-1 rounded-full bg-zinc-700/50 overflow-hidden w-full">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct * 100}%`,
                background: pct >= 1 ? GREEN : pct >= 0.75 ? ORANGE : "#6366f1",
              }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-9 h-9 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-200 text-lg font-bold flex items-center justify-center active:scale-95 hover:bg-zinc-700 transition-all select-none"
        >
          −
        </button>
        <span className="w-10 text-center text-xl font-bold tabular-nums text-white">{value}</span>
        <button
          onClick={() => onChange(max !== undefined ? Math.min(max, value + 1) : value + 1)}
          className="w-9 h-9 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-200 text-lg font-bold flex items-center justify-center active:scale-95 hover:bg-zinc-700 transition-all select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

const DIE_TYPES = ["10″ Thin", "10″ Rising", "12″ Thin", "12″ Rising", "14″"];

export function Streamlined() {
  const [die, setDie] = useState("10″ Thin");
  const [cases, setCases] = useState(480);
  const [skids, setSkids] = useState(3);
  const [casesOnSkid, setCasesOnSkid] = useState(18);
  const [trays, setTrays] = useState(22);
  const [batches, setBatches] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const casesPerSkid = 24;
  const totalSkids = Math.floor(cases / casesPerSkid);
  const casesComplete = skids * casesPerSkid + casesOnSkid;
  const overallPct = cases > 0 ? Math.min(1, casesComplete / cases) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans px-4 py-4 max-w-[390px] mx-auto flex flex-col gap-0">

      {/* Run header chip */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e]" />
          <span className="text-sm font-semibold text-zinc-300">Run 1{die ? ` · ${die}` : ""}</span>
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">08:14 elapsed</span>
      </div>

      {/* ── TARGET ── */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-3 mb-3">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Target</p>

        {/* Cases needed */}
        <div>
          <label className="text-xs text-zinc-400 font-medium block mb-1.5">Cases Needed</label>
          <input
            type="number"
            value={cases}
            onChange={e => setCases(Number(e.target.value))}
            className="w-full rounded-xl bg-zinc-800 border border-zinc-700 text-white text-base font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums"
          />
          {/* Overall progress bar */}
          <div className="mt-2.5 space-y-1">
            <div className="flex justify-between text-[10px] font-semibold text-zinc-500">
              <span>{casesComplete} of {cases} cases</span>
              <span>{Math.round(overallPct * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${overallPct * 100}%`,
                  background: overallPct >= 1 ? GREEN : "#6366f1",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── PROGRESS ── */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 pt-4 pb-2 mb-3">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Progress</p>

        <Stepper label="Skids" value={skids} onChange={setSkids} max={totalSkids} />
        <div className="border-t border-zinc-800" />
        <Stepper label="Cases on skid" value={casesOnSkid} onChange={setCasesOnSkid} max={casesPerSkid} badge={casesOnSkid >= casesPerSkid - 3 ? "Almost full" : undefined} />
        <div className="border-t border-zinc-800" />
        <Stepper label="Trays on line" value={trays} onChange={setTrays} />
        <div className="border-t border-zinc-800" />
        <Stepper label="Dough batches ready" value={batches} onChange={setBatches} max={3} />

        {/* Skid Done action */}
        <button
          onClick={() => { setSkids(s => s + 1); setCasesOnSkid(0); }}
          className="mt-3 mb-1 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-600/40 text-emerald-400 text-sm font-semibold transition-colors active:scale-[0.98]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Skid Done — log &amp; reset
        </button>
      </div>

      {/* ── LINE SETTINGS (collapsible) ── */}
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden mb-3">
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Line Settings</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 font-semibold">Supervisor</span>
          </div>
          <svg
            className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${settingsOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {settingsOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/60 pt-3">
            {/* Die type */}
            <div>
              <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1.5">Die Type</label>
              <div className="flex flex-wrap gap-1.5">
                {DIE_TYPES.map(d => (
                  <button
                    key={d}
                    onClick={() => setDie(d)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                      die === d
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-zinc-800" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Crusts / Cycle</label>
                <input defaultValue="16" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Cycle Speed</label>
                <input defaultValue="4.2" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Speed Adj.</label>
                <input defaultValue="1.0" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Freezer Time (min)</label>
                <input defaultValue="45" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
            </div>
            <div className="border-t border-zinc-800 pt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Pizzas / Case</label>
                <input defaultValue="12" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Cases / Skid</label>
                <input defaultValue="24" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Extra Case Buffer</label>
                <input defaultValue="0" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">Doughballs / Tray</label>
                <input defaultValue="8" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm font-bold px-3 py-2 focus:outline-none focus:border-indigo-500 tabular-nums" />
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
