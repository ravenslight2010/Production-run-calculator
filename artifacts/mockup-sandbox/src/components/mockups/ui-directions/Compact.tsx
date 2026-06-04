import { Play, Pause, AlertTriangle } from "lucide-react";

export function Compact() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800">
      {/* Header - 40px */}
      <header className="h-[40px] px-2 flex items-center justify-between border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-zinc-100">RUN-084-A</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-green-500/20 text-green-400 uppercase">
            Active
          </span>
        </div>
        <div className="text-sm font-mono text-zinc-400">09:41 AM</div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-2 gap-3 overflow-hidden">
        
        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-2 shrink-0">
          <div className="h-[60px] flex flex-col justify-center bg-zinc-900 rounded p-1.5">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Cases</span>
            <span className="text-lg font-semibold tabular-nums leading-none">42<span className="text-xs text-zinc-500">/288</span></span>
          </div>
          <div className="h-[60px] flex flex-col justify-center bg-zinc-900 rounded p-1.5">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">CPH</span>
            <span className="text-lg font-semibold tabular-nums leading-none">218</span>
          </div>
          <div className="h-[60px] flex flex-col justify-center bg-zinc-900 rounded p-1.5">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Skid</span>
            <span className="text-lg font-semibold tabular-nums leading-none">3<span className="text-xs text-zinc-500">/8</span></span>
          </div>
          <div className="h-[60px] flex flex-col justify-center bg-zinc-900 rounded p-1.5">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Batch</span>
            <span className="text-lg font-semibold tabular-nums leading-none">2</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex flex-col gap-1 shrink-0">
          <div className="flex justify-between items-end">
            <span className="text-xs text-zinc-400">Run Progress</span>
            <span className="text-xs font-mono text-zinc-300">14.6%</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: "14.6%" }} />
          </div>
        </div>

        <hr className="border-zinc-800 my-1" />

        {/* Timing Section */}
        <div className="flex flex-col shrink-0">
          <div className="h-[36px] flex justify-between items-center px-1">
            <span className="text-sm text-zinc-400">Next Batch</span>
            <span className="text-sm font-mono text-zinc-200">04:32</span>
          </div>
          <div className="h-[36px] flex justify-between items-center px-1 border-t border-zinc-900/50">
            <span className="text-sm text-zinc-400">Skid Done</span>
            <span className="text-sm font-mono text-zinc-200">12:18</span>
          </div>
          <div className="h-[36px] flex justify-between items-center px-1 border-t border-zinc-900/50">
            <span className="text-sm text-zinc-400">Est. Finish</span>
            <span className="text-sm font-mono text-zinc-200">2:27 PM</span>
          </div>
        </div>

        <hr className="border-zinc-800 my-1" />

        {/* Dough Section */}
        <div className="bg-zinc-900/50 rounded p-2 flex flex-col gap-1 shrink-0">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Dough Status</span>
          <div className="text-sm text-zinc-300">
            <span className="text-zinc-100">Ready:</span> 3 batches / 1,260 balls <span className="text-zinc-600 mx-1">|</span> <span className="text-amber-400">Need:</span> 6.2 more
          </div>
        </div>

        {/* Stoppages */}
        <div className="mt-auto h-[32px] flex items-center justify-center bg-zinc-900/30 border border-zinc-800/50 rounded shrink-0">
          <span className="text-xs text-zinc-500">No stoppages today</span>
        </div>
      </main>

      {/* Bottom Action Bar */}
      <footer className="h-[68px] p-2 border-t border-zinc-800 bg-zinc-950 shrink-0 flex gap-2">
        <button className="flex-1 h-[52px] flex flex-col items-center justify-center gap-0.5 bg-red-950/30 text-red-400 border border-red-900/50 rounded active:bg-red-900/50 transition-colors">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Log Stop</span>
        </button>
        <button className="flex-1 h-[52px] flex flex-col items-center justify-center gap-0.5 bg-zinc-800 text-zinc-300 rounded active:bg-zinc-700 transition-colors">
          <Pause className="w-4 h-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Pause</span>
        </button>
        <button className="flex-[1.5] h-[52px] flex flex-col items-center justify-center gap-0.5 bg-blue-600 text-white rounded active:bg-blue-700 transition-colors">
          <Play className="w-4 h-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Skid Done</span>
        </button>
      </footer>
    </div>
  );
}
