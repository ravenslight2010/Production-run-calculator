import { Play, Square, Pause, Plus, Check } from "lucide-react";

export function ColorStatus() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#0d2d1a] text-white font-sans p-4 pt-8 md:pt-4">
      <header className="flex flex-col gap-2 mb-8">
        <div className="flex justify-between items-start">
          <div className="flex flex-col">
            <span className="text-sm text-green-200/80 font-medium uppercase tracking-wider">Run 1</span>
            <h1 className="text-3xl font-bold tracking-tight mt-0.5">Margherita</h1>
          </div>
          <span className="text-xl font-bold tracking-tight font-mono opacity-90">7:42 AM</span>
        </div>
        
        <div className="flex items-center gap-2 mt-2 bg-black/30 self-start px-3 py-1.5 rounded-full border border-green-500/30 shadow-inner">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          <span className="text-xs font-bold tracking-widest text-green-400">RUNNING</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col gap-6 justify-center pb-8">
        <div className="flex flex-col items-center justify-center py-4">
          <div className="text-[5rem] leading-none font-black tabular-nums tracking-tighter drop-shadow-lg">
            2:14
          </div>
          <div className="text-xl text-green-200/80 mt-2 font-medium uppercase tracking-widest">Remaining</div>
        </div>

        <div className="bg-black/25 rounded-[24px] p-6 border border-white/5 shadow-xl backdrop-blur-sm">
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-lg font-medium text-green-100">Next Batch In</h2>
            <span className="text-3xl font-bold tabular-nums tracking-tight">04:32</span>
          </div>
          <div className="h-5 bg-black/50 rounded-full overflow-hidden shadow-inner">
            <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full shadow-sm relative overflow-hidden" style={{ width: '65%' }}>
              <div className="absolute inset-0 bg-white/20" style={{ transform: 'skewX(-20deg) translateX(-150%)', animation: 'shimmer 2s infinite' }} />
            </div>
          </div>
        </div>

        <div className="bg-black/25 rounded-[24px] p-6 border border-white/5 shadow-xl backdrop-blur-sm">
          <div className="flex justify-between items-end mb-1">
            <h2 className="text-lg font-medium text-green-100">Skid 3 of 8</h2>
            <div className="text-right flex items-baseline gap-1">
              <span className="text-3xl font-bold tabular-nums tracking-tight">42</span>
              <span className="text-xl text-green-200/60">/ 48</span>
            </div>
          </div>
          <div className="text-sm text-green-200/60 mb-4 text-right uppercase tracking-wider font-semibold">Cases</div>
          <div className="h-8 bg-black/50 rounded-full overflow-hidden p-1.5 shadow-inner">
            <div className="h-full bg-green-500 rounded-full shadow-sm" style={{ width: '87.5%' }}></div>
          </div>
        </div>
      </div>

      <div className="mt-auto pb-6 grid grid-cols-3 gap-3">
        <button className="flex flex-col items-center justify-center gap-3 bg-red-950/60 hover:bg-red-900/80 active:bg-red-900 border border-red-900/50 text-red-200 py-5 rounded-[20px] transition-colors">
          <div className="bg-red-500/20 p-2.5 rounded-full">
            <Square className="w-7 h-7 fill-current" />
          </div>
          <span className="text-[15px] font-bold">Log Stop</span>
        </button>
        
        <button className="flex flex-col items-center justify-center gap-3 bg-amber-950/60 hover:bg-amber-900/80 active:bg-amber-900 border border-amber-900/50 text-amber-200 py-5 rounded-[20px] transition-colors">
          <div className="bg-amber-500/20 p-2.5 rounded-full">
            <Pause className="w-7 h-7 fill-current" />
          </div>
          <span className="text-[15px] font-bold">Pause</span>
        </button>
        
        <button className="flex flex-col items-center justify-center gap-3 bg-green-500 hover:bg-green-400 active:bg-green-600 text-green-950 py-5 rounded-[20px] transition-colors shadow-lg shadow-green-900/50">
          <div className="bg-green-950/20 p-2.5 rounded-full">
            <Check className="w-7 h-7" strokeWidth={3} />
          </div>
          <span className="text-[15px] font-bold">Skid Done</span>
        </button>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes shimmer {
          100% { transform: skewX(-20deg) translateX(200%); }
        }
      `}} />
    </div>
  );
}
