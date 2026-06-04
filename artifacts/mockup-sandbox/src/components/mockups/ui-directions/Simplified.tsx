import React, { useState } from 'react';

export function Simplified() {
  const [setupMode, setSetupMode] = useState(false);

  if (setupMode) {
    return (
      <div className="min-h-screen w-full bg-zinc-950 text-white flex flex-col p-6">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-100">Setup Mode</h1>
          <button 
            onClick={() => setSetupMode(false)}
            className="p-3 bg-zinc-800 rounded-full text-zinc-300 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          Configuration options would go here
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-black text-white flex flex-col justify-between font-sans overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center p-6 text-zinc-400">
        <h1 className="text-xl font-medium tracking-wide">Margherita <span className="text-zinc-600">|</span> Run 1</h1>
        <button 
          onClick={() => setSetupMode(true)}
          className="p-2 hover:bg-zinc-900 rounded-full transition-colors"
          aria-label="Setup"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
      </header>

      {/* Dominant Center Area */}
      <main className="flex-1 flex flex-col items-center justify-center space-y-12">
        <div className="flex flex-col items-center">
          <div className="text-[100px] leading-none font-bold tracking-tight">42</div>
          <div className="text-zinc-500 font-semibold tracking-[0.2em] text-sm mt-2">CASES DONE</div>
        </div>

        <div className="flex flex-col items-center">
          <div className="text-[80px] leading-none font-bold tracking-tight">3 / 8</div>
          <div className="text-zinc-500 font-semibold tracking-[0.2em] text-sm mt-2">SKIDS</div>
        </div>

        <div className="flex flex-col items-center">
          <div className="text-[100px] leading-none font-bold tracking-tight text-amber-500 animate-pulse">04:32</div>
          <div className="text-amber-500/70 font-semibold tracking-[0.2em] text-sm mt-2">NEXT BATCH</div>
        </div>
      </main>

      {/* Bottom Section */}
      <div className="w-full pb-6 px-4 space-y-6">
        
        {/* Progress Bar */}
        <div className="px-2">
          <div className="flex justify-between text-xs text-zinc-500 mb-2 font-mono">
            <span>RUN PROGRESS</span>
            <span>37%</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
            <div className="h-full bg-zinc-300 rounded-full" style={{ width: '37%' }}></div>
          </div>
        </div>

        {/* Status Strip */}
        <div className="text-center font-mono text-xs text-zinc-500">
          Est. finish: 2:27 PM <span className="text-zinc-700 mx-2">&middot;</span> CPH: 218 <span className="text-zinc-700 mx-2">&middot;</span> Downtime: 0m
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button className="flex-1 h-[72px] bg-zinc-900 hover:bg-zinc-800 text-red-400 font-medium text-lg rounded-2xl transition-colors flex items-center justify-center gap-2">
            <span className="text-xl">🛑</span> Log Stop
          </button>
          <button className="flex-1 h-[72px] bg-zinc-900 hover:bg-zinc-800 text-amber-400 font-medium text-lg rounded-2xl transition-colors flex items-center justify-center gap-2">
            <span className="text-xl">⏸</span> Pause
          </button>
          <button className="flex-1 h-[72px] bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-lg rounded-2xl transition-colors flex items-center justify-center gap-2">
            <span className="text-xl">✅</span> Skid Done
          </button>
        </div>
      </div>
    </div>
  );
}