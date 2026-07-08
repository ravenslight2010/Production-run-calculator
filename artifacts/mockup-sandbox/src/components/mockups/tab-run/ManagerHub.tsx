import { 
  Play, 
  Pause, 
  Square, 
  AlertTriangle, 
  Snowflake, 
  ChevronLeft, 
  ChevronRight, 
  Activity, 
  Settings,
  ArrowRight,
  Pencil,
  Plus,
  ChevronDown,
  Clock
} from "lucide-react";

export function ManagerHub() {
  return (
    <div className="min-h-screen bg-neutral-950 text-slate-300 font-sans p-4 space-y-6 max-w-[620px] mx-auto pb-24">
      {/* 0. Top Bar: New Run & Context */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400 font-bold uppercase tracking-wider bg-neutral-900 px-2 py-1 rounded border border-neutral-800">
            Run 2 of 4
          </span>
          <span className="text-xs text-neutral-500 font-medium">Last ran: 6/24 · 830 cases · 12.5 lbs waste</span>
        </div>
        <button className="flex items-center gap-1.5 text-xs font-bold text-amber-500 hover:text-amber-400 transition-colors bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
          <Plus className="w-3.5 h-3.5" />
          NEW RUN
        </button>
      </div>

      {/* 1. Editable Setup Header */}
      <div className="bg-neutral-900 border-2 border-neutral-800 rounded-xl p-4 flex flex-col gap-4 relative">
        <div className="absolute top-0 right-0 m-4 flex gap-1">
           <div className="px-2 py-1 flex items-center gap-1 bg-neutral-800 rounded text-xs font-bold text-slate-300 border border-neutral-700">
             TX-16
           </div>
           <div className="px-2 py-1 bg-red-950/40 text-red-400 border border-red-900/50 rounded text-xs font-bold uppercase">
             Wheat/Dairy
           </div>
        </div>

        <div>
          <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            Run Setup
            <Pencil className="w-3 h-3 ml-1" />
          </div>
          
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <button className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors rounded-lg p-2.5 flex items-center justify-between text-left group">
                <div className="flex flex-col">
                  <span className="text-[10px] text-neutral-500 uppercase font-medium">Brand & Flavor</span>
                  <span className="text-base font-bold text-slate-100 mt-0.5">
                    Cornerbooth <span className="text-amber-500 mx-1">—</span> Pepperoni
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400" />
              </button>
            </div>
            
            <div className="w-32">
              <button className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors rounded-lg p-2.5 flex items-center justify-between text-left group">
                <div className="flex flex-col">
                  <span className="text-[10px] text-neutral-500 uppercase font-medium">Target Cases</span>
                  <span className="text-lg font-black text-white leading-none mt-0.5 tabular-nums">850</span>
                </div>
                <Pencil className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-400" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Prioritized Alert Strip */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 bg-blue-950/30 border border-blue-900/50 p-2.5 rounded-lg text-blue-400">
          <Snowflake className="w-5 h-5 flex-shrink-0 animate-pulse" />
          <div className="flex-1 text-sm font-medium">
            Freezer filling — First cases exit in <span className="font-bold text-blue-300">07:12</span> (35m tunnel)
          </div>
        </div>
        <div className="flex items-center gap-3 bg-amber-950/30 border border-amber-900/50 p-2.5 rounded-lg text-amber-500">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div className="flex-1 text-sm font-medium">
            Die change required for next run: <span className="font-bold text-amber-400">TX-16 <ArrowRight className="inline w-3 h-3 mx-1" /> RD-12</span>
          </div>
        </div>
      </div>

      {/* 3. Giant KPI Tiles (The Cockpit) */}
      <div className="grid grid-cols-2 gap-4">
        {/* Progress Tile */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 flex flex-col items-center justify-center relative overflow-hidden shadow-lg shadow-black/20">
          <div className="absolute top-3 left-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Completion</div>
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold text-emerald-500 uppercase tracking-wide">Running</span>
          </div>
          
          <div className="mt-6 mb-2">
            <div className="text-6xl font-black text-white tabular-nums tracking-tighter">314</div>
          </div>
          <div className="text-sm font-bold text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            37% Done
          </div>
          
          <div className="w-full bg-neutral-950 h-3.5 rounded-full mt-5 border border-neutral-800 overflow-hidden shadow-inner relative">
            <div className="absolute inset-0 bg-neutral-900 opacity-50"></div>
            <div className="bg-gradient-to-r from-amber-600 to-amber-400 h-full rounded-full relative" style={{ width: '37%' }}></div>
          </div>
          <div className="w-full flex justify-between mt-2 text-xs text-neutral-400 font-medium">
            <span>0</span>
            <span>536 left</span>
            <span>850</span>
          </div>
        </div>

        {/* Pace & Time Tile */}
        <div className="flex flex-col gap-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex-1 flex flex-col justify-center shadow-lg shadow-black/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Pace</span>
              <span className="text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">
                12 cases behind
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-white tabular-nums tracking-tight">4.2</span>
              <span className="text-sm text-neutral-400 font-bold uppercase">PPM</span>
            </div>
            <div className="text-xs font-medium text-neutral-400 mt-2">
              Need <strong className="text-amber-500">4.8 PPM</strong> to finish on time
            </div>
            <div className="text-xs font-medium text-neutral-500 mt-1 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              6m 40s downtime
            </div>
          </div>
          
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex-1 flex flex-col justify-center shadow-lg shadow-black/20">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Est. Finish</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white tabular-nums tracking-tight">1h 52m</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="text-sm font-medium text-slate-300">at 4:37 PM</div>
              <div className="text-xs font-bold text-red-400 border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded">
                +8 min
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Giant Controls (Touch Confidence) */}
      <div className="grid grid-cols-2 gap-3">
        <button className="bg-amber-600 hover:bg-amber-500 text-neutral-950 font-black text-lg py-5 rounded-xl flex items-center justify-center gap-3 transition-colors shadow-lg shadow-amber-900/20 active:translate-y-0.5">
          <Pause className="w-6 h-6 fill-current" />
          PAUSE RUN
        </button>
        <button className="bg-neutral-800 hover:bg-neutral-700 text-slate-100 font-black text-lg py-5 rounded-xl border border-neutral-700 flex items-center justify-center gap-3 transition-colors shadow-lg shadow-black/20 active:translate-y-0.5">
          <Square className="w-6 h-6 fill-current" />
          STOP RUN
        </button>
        <button className="col-span-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-bold text-sm py-4 rounded-xl border border-neutral-800 flex items-center justify-center gap-2 transition-colors active:translate-y-0.5">
          <Activity className="w-4 h-4" />
          LOG STOPPAGE
        </button>
      </div>

      <div className="flex items-center justify-center text-xs text-neutral-500 font-medium px-2">
        <div className="bg-neutral-900 px-3 py-1.5 rounded-full border border-neutral-800">
          Elapsed Time: <span className="text-neutral-300 font-bold tabular-nums">2h 14m</span>
        </div>
      </div>

      {/* 5. Dense Secondary Grid (Run Details) */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
        <div className="bg-neutral-800/50 px-4 py-3 border-b border-neutral-800">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Line Details</h3>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-neutral-800">
          <div className="p-3 flex justify-between items-center">
            <span className="text-xs text-neutral-400 font-medium">Cases Left</span>
            <span className="text-sm font-bold text-white tabular-nums">536</span>
          </div>
          <div className="p-3 flex justify-between items-center">
            <span className="text-xs text-neutral-400 font-medium">On Line</span>
            <span className="text-sm font-bold text-white tabular-nums">~27</span>
          </div>
          <div className="p-3 flex justify-between items-center col-span-2">
            <span className="text-xs text-neutral-400 font-medium">Dough Status</span>
            <span className="text-sm font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">+3.5 cases ahead</span>
          </div>
          <div className="p-3 flex justify-between items-center col-span-2">
            <span className="text-xs text-neutral-400 font-medium">Cases on Last</span>
            <span className="text-sm font-bold text-white tabular-nums">14</span>
          </div>
        </div>
      </div>

      {/* 6. Editable Adjustments */}
      <div className="space-y-4 pt-4 border-t border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-neutral-400" />
            <h3 className="text-sm font-bold text-slate-300">Temporary Adjustments</h3>
          </div>
          <button className="text-[10px] font-bold text-amber-500 hover:text-amber-400 uppercase tracking-wider bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
            Clear All
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <button className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors rounded-lg p-3 relative text-left group">
            <div className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full -mt-1 -mr-1 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></div>
            <div className="flex justify-between items-start mb-1">
              <div className="text-[10px] text-neutral-500 uppercase font-bold line-clamp-1">Freezer Time</div>
              <Pencil className="w-3 h-3 text-neutral-600 group-hover:text-neutral-400" />
            </div>
            <div className="text-lg font-black text-white tabular-nums">35m</div>
          </button>
          <button className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors rounded-lg p-3 relative text-left group">
            <div className="flex justify-between items-start mb-1">
              <div className="text-[10px] text-neutral-500 uppercase font-bold line-clamp-1">Crusts/Cycle</div>
              <Pencil className="w-3 h-3 text-neutral-600 group-hover:text-neutral-400" />
            </div>
            <div className="text-lg font-black text-white tabular-nums">3</div>
          </button>
          <button className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors rounded-lg p-3 relative text-left group">
            <div className="flex justify-between items-start mb-1">
              <div className="text-[10px] text-neutral-500 uppercase font-bold line-clamp-1">Cycle Speed</div>
              <Pencil className="w-3 h-3 text-neutral-600 group-hover:text-neutral-400" />
            </div>
            <div className="text-lg font-black text-white tabular-nums">1.2s</div>
          </button>
        </div>

        {/* 7. Run Navigation */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 mt-6 shadow-inner relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-800/20 to-transparent pointer-events-none"></div>
          <div className="flex items-center justify-between relative z-10">
            <button className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm font-medium p-1 -ml-1 rounded hover:bg-neutral-800">
              <ChevronLeft className="w-4 h-4" />
              <div className="flex flex-col items-start">
                <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-500">Previous</span>
                <span className="truncate max-w-[100px] text-xs">Aldo's Cheese</span>
              </div>
            </button>
            <div className="flex gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-neutral-600"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-neutral-800"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-neutral-800"></div>
            </div>
            <button className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm font-medium text-right p-1 -mr-1 rounded hover:bg-neutral-800">
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-500">Next</span>
                <span className="truncate max-w-[100px] text-xs">Cornerbooth Sausage</span>
              </div>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
