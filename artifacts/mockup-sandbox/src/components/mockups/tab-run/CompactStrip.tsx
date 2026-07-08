import { 
  Play, 
  Pause, 
  AlertTriangle, 
  Snowflake, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  Timer
} from "lucide-react";
import { useState } from "react";

export function CompactStrip() {
  return (
    <div className="min-h-screen bg-neutral-950 text-slate-300 font-sans max-w-[620px] mx-auto pb-24 flex flex-col">
      
      {/* Pinned Header Area */}
      <div className="sticky top-0 z-50 flex flex-col shadow-xl shadow-black/50">
        
        {/* Main Run Strip */}
        <div className="bg-neutral-900 border-b border-neutral-800 relative group cursor-pointer active:bg-neutral-800/80 transition-colors">
          {/* Top colored accent edge */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500"></div>
          
          <div className="p-3 flex items-center justify-between gap-3">
            {/* Left Col: Status & Identity */}
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2 w-2 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Running · 2h 14m</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-slate-100 truncate">Cornerbooth <span className="text-amber-500 mx-1">—</span> Pepperoni</span>
                <span className="text-[10px] font-bold text-neutral-500 uppercase flex-shrink-0 flex items-center hover:text-white">
                  Run 2/4 <ChevronRight className="w-3 h-3 ml-0.5" />
                </span>
              </div>
            </div>

            {/* Middle Col: Stats */}
            <div className="flex flex-col flex-1 items-end text-right min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-black text-white tabular-nums">314</span>
                <span className="text-[10px] text-neutral-500">/ 850</span>
                <span className="text-[10px] font-bold text-amber-500">37%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded border border-red-400/20 tabular-nums">
                  <ChevronDown className="w-3 h-3" />
                  12 · 4.2 PPM
                </div>
                <div className="text-[10px] font-medium text-neutral-400 tabular-nums">
                  Est 4:37 PM
                </div>
              </div>
            </div>

            {/* Right Col: Actions */}
            <div className="flex items-center gap-2 flex-shrink-0 border-l border-neutral-800 pl-3">
              <button className="bg-amber-600/20 text-amber-500 hover:bg-amber-500 hover:text-neutral-950 p-2.5 rounded-lg transition-colors border border-amber-500/30">
                <Pause className="w-5 h-5 fill-current" />
              </button>
            </div>
          </div>
          
          {/* Ultra-compact progress bar at bottom of strip */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-neutral-800">
            <div className="h-full bg-amber-500" style={{ width: '37%' }}></div>
          </div>
        </div>

        {/* Compact Alert Line */}
        <div className="bg-blue-950/40 border-b border-blue-900/50 px-3 py-1.5 flex items-center justify-center gap-2 text-blue-400 shadow-inner cursor-pointer">
          <Snowflake className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />
          <span className="text-[11px] font-medium uppercase tracking-wide">
            Freezer filling in <span className="font-bold text-blue-300">07:12</span>
          </span>
        </div>
      </div>

      {/* Tab Body (Simplified Dough Tab) */}
      <div className="flex-1 p-4 flex flex-col gap-6 opacity-75">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Dough</h2>
          <div className="bg-neutral-900 rounded-lg p-1 flex items-center border border-neutral-800">
            <button className="px-3 py-1 rounded bg-neutral-800 text-sm font-bold text-white shadow">Dough</button>
            <button className="px-3 py-1 rounded text-sm font-medium text-neutral-400 hover:text-white">Crusts</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col">
            <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-2">Batches Ready</span>
            <span className="text-3xl font-black text-white tabular-nums">3</span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col">
            <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-2">Trays on Line</span>
            <span className="text-3xl font-black text-white tabular-nums">12</span>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-neutral-300">
            <Timer className="w-5 h-5 text-neutral-500" />
            <div className="flex flex-col">
              <span className="text-sm font-bold">Next batch due</span>
              <span className="text-xs text-neutral-500">Based on current pace</span>
            </div>
          </div>
          <span className="text-xl font-bold tabular-nums text-amber-500">08:45</span>
        </div>

        <div className="mt-4 border-t border-neutral-800 pt-6">
          <h3 className="text-xs text-neutral-500 uppercase font-bold tracking-wider mb-4">Manual Adjustment</h3>
          <div className="flex gap-3">
            <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-400">Waste (lbs)</span>
              <input type="number" defaultValue="0" className="bg-transparent text-right font-bold text-white w-20 outline-none" />
            </div>
            <button className="bg-neutral-800 text-white font-bold px-4 rounded-xl border border-neutral-700">Add</button>
          </div>
        </div>
        
      </div>
      
      {/* Bottom Nav Placeholder */}
      <div className="fixed bottom-0 left-0 right-0 max-w-[620px] mx-auto h-16 bg-neutral-950 border-t border-neutral-900 flex justify-between px-6 items-center z-50">
        <div className="w-8 h-8 rounded-full bg-neutral-900"></div>
        <div className="w-8 h-8 rounded-full bg-neutral-900"></div>
        <div className="w-8 h-8 rounded-full bg-neutral-800 ring-2 ring-amber-500/20"></div>
        <div className="w-8 h-8 rounded-full bg-neutral-900"></div>
        <div className="w-8 h-8 rounded-full bg-neutral-900"></div>
      </div>
    </div>
  );
}
