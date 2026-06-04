import { useState } from "react";
import { Settings, X } from "lucide-react";

export function SimplifiedColor() {
  const [setupMode, setSetupMode] = useState(false);
  const status: "running" | "paused" | "stopped" = "running";

  const bg = {
    running: "#071a0f",
    paused:  "#1a1100",
    stopped: "#1a0707",
  }[status];

  const accent = {
    running: { primary: "#4ade80", dim: "#166534", label: "#166534", bar: "#22c55e", dot: "#4ade80", badge: "#14532d", badgeText: "#bbf7d0" },
    paused:  { primary: "#fbbf24", dim: "#78350f", label: "#78350f", bar: "#f59e0b", dot: "#fbbf24", badge: "#713f12", badgeText: "#fef3c7" },
    stopped: { primary: "#f87171", dim: "#7f1d1d", label: "#7f1d1d", bar: "#ef4444", dot: "#f87171", badge: "#7f1d1d", badgeText: "#fee2e2" },
  }[status];

  const statusLabel = { running: "RUNNING", paused: "PAUSED", stopped: "STOPPAGE" }[status];

  if (setupMode) {
    return (
      <div className="min-h-screen w-full flex flex-col p-6 font-sans" style={{ background: bg, color: "white" }}>
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-semibold">Setup Mode</h1>
          <button
            onClick={() => setSetupMode(false)}
            className="p-3 rounded-full transition-colors"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <X className="w-5 h-5" style={{ color: "rgba(255,255,255,0.7)" }} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center" style={{ color: "rgba(255,255,255,0.25)" }}>
          Configuration options here
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between font-sans overflow-hidden"
      style={{ background: bg, color: "white" }}
    >
      {/* Header */}
      <header className="flex justify-between items-center px-6 pt-6 pb-2">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>
            Margherita <span style={{ color: "rgba(255,255,255,0.2)" }}>|</span> Run 1
          </h1>
          <span
            className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest"
            style={{ background: accent.badge, color: accent.badgeText }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: accent.dot }}
            />
            {statusLabel}
          </span>
        </div>
        <button
          onClick={() => setSetupMode(true)}
          className="p-2.5 rounded-full transition-colors"
          style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}
          aria-label="Setup"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Dominant center numbers */}
      <main className="flex-1 flex flex-col items-center justify-center gap-10 py-4">
        <div className="flex flex-col items-center">
          <div
            className="text-[100px] leading-none font-black tracking-tight tabular-nums"
            style={{ color: "white" }}
          >
            42
          </div>
          <div
            className="text-sm font-bold tracking-[0.22em] mt-2"
            style={{ color: accent.primary, opacity: 0.7 }}
          >
            CASES DONE
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div
            className="text-[80px] leading-none font-black tracking-tight tabular-nums"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            3 / 8
          </div>
          <div
            className="text-sm font-bold tracking-[0.22em] mt-2"
            style={{ color: accent.primary, opacity: 0.7 }}
          >
            SKIDS
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div
            className="text-[100px] leading-none font-black tracking-tight tabular-nums animate-pulse"
            style={{ color: accent.primary }}
          >
            04:32
          </div>
          <div
            className="text-sm font-bold tracking-[0.22em] mt-2"
            style={{ color: accent.primary, opacity: 0.6 }}
          >
            NEXT BATCH
          </div>
        </div>
      </main>

      {/* Bottom section */}
      <div className="w-full px-4 pb-6 space-y-5">
        {/* Progress bar */}
        <div className="px-2">
          <div
            className="flex justify-between text-xs font-mono mb-1.5"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            <span>RUN PROGRESS</span>
            <span>37%</span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: "37%", background: accent.bar }}
            />
          </div>
        </div>

        {/* Status strip */}
        <div
          className="text-center font-mono text-xs"
          style={{ color: "rgba(255,255,255,0.28)" }}
        >
          Est. finish: 2:27 PM
          <span style={{ color: "rgba(255,255,255,0.12)", margin: "0 8px" }}>·</span>
          CPH: 218
          <span style={{ color: "rgba(255,255,255,0.12)", margin: "0 8px" }}>·</span>
          Downtime: 0m
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            className="flex-1 h-[72px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
            style={{ background: "rgba(127,29,29,0.45)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            🛑 Log Stop
          </button>
          <button
            className="flex-1 h-[72px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "#fbbf24", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            ⏸ Pause
          </button>
          <button
            className="flex-1 h-[72px] rounded-2xl font-medium text-base flex items-center justify-center gap-2 transition-colors"
            style={{ background: accent.primary, color: bg }}
          >
            ✅ Skid Done
          </button>
        </div>
      </div>
    </div>
  );
}
