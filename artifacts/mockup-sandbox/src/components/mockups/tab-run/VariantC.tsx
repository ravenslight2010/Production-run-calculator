import React from "react";
import { 
  Play, 
  Pause, 
  Square, 
  Settings2,
  AlertTriangle,
  Clock,
  ArrowRight,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  Activity,
  Snowflake,
  Timer,
  Check
} from "lucide-react";

export function VariantC() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans w-full max-w-[620px] mx-auto overflow-hidden flex flex-col relative selection:bg-amber-500/30">
      
      {/* Command Bar (Sticky) */}
      <div className="sticky top-0 z-50 bg-neutral-900 border-b border-neutral-800 shadow-2xl shadow-black/50">
        <div className="p-3 pb-2 flex flex-col gap-2">
          {/* Top row: Identity & Controls */}
          <div className="flex justify-between items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-neutral-800 text-neutral-400 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-wider">Run 2 of 4</span>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Last ran: 2 days ago</span>
              </div>
              <h1 className="text-lg font-bold text-white leading-tight truncate">
                Cornerbooth <span className="text-neutral-500 font-normal">—</span> Pepperoni
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="bg-blue-500/20 text-blue-400 text-xs font-bold px-1.5 py-0.5 rounded">TX-16</span>
                <span className="bg-red-500/20 text-red-400 text-xs font-bold px-1.5 py-0.5 rounded">Dairy, Wheat</span>
              </div>
            </div>

            <div className="flex flex-col items-end shrink-0 gap-1.5">
              <div className="flex items-center gap-1.5 bg-neutral-950 rounded-lg p-1 border border-neutral-800">
                <div className="flex items-center gap-1.5 px-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse" />
                  <span className="text-amber-500 font-mono font-bold text-sm">2h 14m</span>
                </div>
                <div className="h-6 w-px bg-neutral-800" />
                <button className="h-8 w-8 flex items-center justify-center rounded bg-neutral-800 hover:bg-neutral-700 text-white transition-colors">
                  <Pause size={14} className="fill-current" />
                </button>
                <button className="h-8 w-8 flex items-center justify-center rounded bg-neutral-800 hover:bg-neutral-700 text-white transition-colors">
                  <Square size={14} className="fill-current" />
                </button>
              </div>
              <div className="text-right">
                <div className="flex items-baseline justify-end gap-1">
                  <span className="text-xl font-bold tracking-tight text-white">850</span>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wide">cases</span>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bar Row */}
          <div className="flex items-center gap-3 mt-1">
            <div className="flex-1 h-3 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
              <div className="h-full bg-amber-500" style={{ width: '37%' }} />
            </div>
            <div className="flex items-baseline gap-1.5 shrink-0">
              <span className="font-mono text-sm font-bold text-white">314</span>
              <span className="text-[10px] text-neutral-500 font-mono">/ 850</span>
              <span className="text-xs font-bold text-amber-500 ml-1">37%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto p-3 bg-neutral-950">
        <div className="grid grid-cols-2 gap-3 pb-8">

          {/* Alert: Start Dough */}
          <div className="col-span-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3 animate-pulse">
            <div className="bg-amber-500 text-neutral-950 p-2 rounded-lg">
              <Timer size={20} className="stroke-[3]" />
            </div>
            <div>
              <h3 className="text-amber-500 font-bold text-sm">Start Next Dough Batch NOW</h3>
              <p className="text-amber-500/70 text-xs mt-0.5">Needed to maintain line pace</p>
            </div>
          </div>

          {/* Tile: Finish Time */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/5 rounded-bl-full pointer-events-none" />
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Est. Finish</span>
              <Clock size={14} className="text-neutral-500" />
            </div>
            <div className="mb-2">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-white tracking-tight">1h 52m</span>
              </div>
              <div className="text-sm font-bold text-neutral-300">4:37 PM</div>
            </div>
            <div className="bg-red-500/10 text-red-400 text-[10px] font-bold px-2 py-1 rounded inline-flex items-center w-fit">
              <TrendingDown size={10} className="mr-1" /> 8 min behind
            </div>
          </div>

          {/* Tile: Pace / PPM */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/5 rounded-bl-full pointer-events-none" />
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Current Pace</span>
              <Activity size={14} className="text-neutral-500" />
            </div>
            <div className="mb-2">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-white tracking-tight">4.2</span>
                <span className="text-sm font-bold text-neutral-500">PPM</span>
              </div>
              <div className="text-sm font-bold text-red-400">-12 cases</div>
            </div>
            <div className="text-[10px] text-neutral-400 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 leading-tight">
              Need <strong className="text-white">4.8 PPM</strong> to catch up.<br/>
              6m 40s downtime today.
            </div>
          </div>

          {/* Tile: Freezer State */}
          <div className="col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Snowflake size={14} className="text-blue-400" />
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Freezer Filling</span>
              </div>
              <span className="font-mono text-sm font-bold text-white">07:12</span>
            </div>
            <div className="h-2 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800 mb-2">
              <div className="h-full bg-blue-500" style={{ width: '20%' }} />
            </div>
            <div className="text-[10px] text-neutral-400 flex justify-between">
              <span>First cases exit in 07:12</span>
              <span>35m tunnel</span>
            </div>
          </div>

          {/* Tile: Alert Die Change */}
          <div className="col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex">
            <div className="w-1.5 bg-blue-500 shrink-0" />
            <div className="p-3 flex-1 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-neutral-800 p-2 rounded-lg">
                  <Settings2 size={16} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Die Change Required Next Run</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-mono font-bold text-neutral-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">TX-16</span>
                    <ArrowRight size={10} className="text-neutral-500" />
                    <span className="text-xs font-mono font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">RD-12</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Small Stats Grid (2x2 inside the 2-col) */}
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">Cases Left</span>
              <span className="text-xl font-black text-white tabular-nums tracking-tight">536</span>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">On Line (approx)</span>
              <span className="text-xl font-black text-white tabular-nums tracking-tight">27</span>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">Dough Status</span>
              <span className="text-xl font-black text-green-400 tabular-nums tracking-tight">+3.5</span>
              <span className="text-xs font-bold text-neutral-400 ml-1">cases</span>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">Cases on Last Skid</span>
              <span className="text-xl font-black text-white tabular-nums tracking-tight">14</span>
            </div>
          </div>

          {/* Micro Stats Row */}
          <div className="col-span-2 flex gap-2">
            <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-0.5">Trays/Skid</span>
              <span className="text-sm font-bold text-white tabular-nums">6.25</span>
            </div>
            <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-0.5">Trays/Batch</span>
              <span className="text-sm font-bold text-white tabular-nums">4.10</span>
            </div>
            <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-0.5">Batches/Skid</span>
              <span className="text-sm font-bold text-white tabular-nums">1.52</span>
            </div>
          </div>

          {/* Temp Adjustments Tile */}
          <div className="col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-3 mt-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Temporary Adjustments</span>
                <span className="bg-amber-500/20 text-amber-500 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border border-amber-500/30">Active</span>
              </div>
              <button className="text-[10px] text-neutral-400 hover:text-white uppercase font-bold">Clear</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-2">
                <span className="text-[9px] text-neutral-500 uppercase font-bold block mb-1">Freezer Time</span>
                <span className="text-sm font-mono text-amber-500 font-bold block">35m</span>
              </div>
              <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-2">
                <span className="text-[9px] text-neutral-500 uppercase font-bold block mb-1">Crusts/Cycle</span>
                <span className="text-sm font-mono text-amber-500 font-bold block">2.0</span>
              </div>
              <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-2">
                <span className="text-[9px] text-neutral-500 uppercase font-bold block mb-1">Cycle Speed</span>
                <span className="text-sm font-mono text-amber-500 font-bold block">14.5s</span>
              </div>
            </div>
          </div>

          {/* Upcoming Runs Tile */}
          <div className="col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-3 mt-2">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Run Sequence</span>
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]" />
                <div className="w-1.5 h-1.5 rounded-full bg-neutral-800" />
                <div className="w-1.5 h-1.5 rounded-full bg-neutral-800" />
              </div>
            </div>
            
            <div className="flex flex-col gap-2 relative before:absolute before:left-3 before:top-4 before:bottom-4 before:w-px before:bg-neutral-800">
              <div className="flex items-center gap-3 relative z-10 opacity-50">
                <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center shrink-0 border border-neutral-700">
                  <Check size={12} className="text-neutral-500" />
                </div>
                <div className="flex-1 bg-neutral-950 border border-neutral-800 rounded p-2 flex justify-between items-center">
                  <span className="text-xs font-bold text-neutral-400">Aldo's — Cheese</span>
                  <span className="text-[10px] text-neutral-500">Run 1</span>
                </div>
              </div>
              
              <div className="flex items-center gap-3 relative z-10">
                <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center shrink-0">
                  <Play size={10} className="text-amber-500 fill-current" />
                </div>
                <div className="flex-1 bg-amber-500/5 border border-amber-500/20 rounded p-2 flex justify-between items-center shadow-[inset_2px_0_0_rgba(245,158,11,1)]">
                  <span className="text-xs font-bold text-amber-500">Cornerbooth — Pepperoni</span>
                  <span className="text-[10px] text-amber-500/70 font-bold">Current</span>
                </div>
              </div>

              <div className="flex items-center gap-3 relative z-10">
                <div className="w-6 h-6 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-neutral-500">3</span>
                </div>
                <div className="flex-1 bg-neutral-950 border border-neutral-800 rounded p-2 flex justify-between items-center">
                  <span className="text-xs font-bold text-white">Cornerbooth — Sausage</span>
                  <span className="text-[10px] text-neutral-500">Next</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <button className="flex items-center gap-1 text-[10px] uppercase font-bold text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded transition-colors">
                <ChevronLeft size={14} /> Prev
              </button>
              <button className="flex items-center gap-1 text-[10px] uppercase font-bold text-neutral-900 bg-white hover:bg-neutral-200 px-3 py-1.5 rounded transition-colors">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
