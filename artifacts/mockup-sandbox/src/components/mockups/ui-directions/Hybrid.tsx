import { Pause, AlertTriangle, Check } from "lucide-react";

export function Hybrid() {
  const status: "running" | "paused" | "stopped" = "running";

  const bg = {
    running: "#0a2218",
    paused:  "#221a02",
    stopped: "#220808",
  }[status];

  const accent = {
    running: { text: "#4ade80", badge: "#166534", badgeText: "#bbf7d0", bar: "#22c55e", dot: "#4ade80" },
    paused:  { text: "#fbbf24", badge: "#78350f", badgeText: "#fef3c7", bar: "#f59e0b", dot: "#fbbf24" },
    stopped: { text: "#f87171", badge: "#7f1d1d", badgeText: "#fee2e2", bar: "#ef4444", dot: "#f87171" },
  }[status];

  const label = { running: "RUNNING", paused: "PAUSED", stopped: "STOPPAGE" }[status];

  return (
    <div
      className="min-h-screen w-full flex flex-col font-sans select-none"
      style={{ background: bg, color: "#f0fdf4" }}
    >
      {/* Header */}
      <header
        className="h-[44px] px-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight">Run 1 — Margherita</span>
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest"
            style={{ background: accent.badge, color: accent.badgeText }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: accent.dot }}
            />
            {label}
          </span>
        </div>
        <span className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>7:42 AM</span>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col px-2 py-2 gap-2 overflow-hidden">

        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-1.5 shrink-0">
          {[
            { label: "Cases", value: "42", sub: "/288" },
            { label: "CPH",   value: "218" },
            { label: "Skid",  value: "3",   sub: "/8" },
            { label: "Batch", value: "2" },
          ].map(({ label, value, sub }) => (
            <div
              key={label}
              className="h-[62px] flex flex-col justify-center rounded-lg px-2"
              style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span
                className="text-[10px] uppercase tracking-wider mb-0.5"
                style={{ color: accent.text, opacity: 0.8 }}
              >
                {label}
              </span>
              <span className="text-lg font-bold tabular-nums leading-none">
                {value}
                {sub && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7em" }}>{sub}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Run Progress */}
        <div className="shrink-0 flex flex-col gap-1 px-1">
          <div className="flex justify-between">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.45)" }}>Run Progress</span>
            <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.55)" }}>14.6%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="h-full rounded-full" style={{ width: "14.6%", background: accent.bar }} />
          </div>
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 4px" }} />

        {/* Timing Rows */}
        <div className="shrink-0">
          {[
            { label: "Next Batch", value: "04:32", highlight: true },
            { label: "Skid Done",  value: "12:18" },
            { label: "Est. Finish", value: "2:27 PM" },
          ].map(({ label, value, highlight }, i) => (
            <div
              key={label}
              className="h-[38px] flex justify-between items-center px-2"
              style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : undefined }}
            >
              <span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>{label}</span>
              <span
                className="text-sm font-mono font-semibold"
                style={{ color: highlight ? accent.text : "rgba(255,255,255,0.9)" }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 4px" }} />

        {/* Dough */}
        <div
          className="shrink-0 rounded-lg px-3 py-2.5"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: accent.text, opacity: 0.8 }}>Dough</div>
          <div className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
            Ready: <span style={{ color: "rgba(255,255,255,0.95)" }}>3 batches · 1,260 balls</span>
            <span style={{ color: "rgba(255,255,255,0.25)", margin: "0 6px" }}>|</span>
            Need: <span style={{ color: "#fbbf24" }}>6.2 more</span>
          </div>
        </div>

        {/* Stoppage strip */}
        <div
          className="shrink-0 h-8 flex items-center justify-center rounded"
          style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.04)" }}
        >
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>No stoppages today</span>
        </div>
      </main>

      {/* Bottom action bar */}
      <footer
        className="px-2 pb-4 pt-2 shrink-0 flex gap-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          className="flex-1 h-[54px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors active:opacity-75"
          style={{ background: "rgba(127,29,29,0.5)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}
        >
          <AlertTriangle className="w-4 h-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Log Stop</span>
        </button>
        <button
          className="flex-1 h-[54px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors active:opacity-75"
          style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}
        >
          <Pause className="w-4 h-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Pause</span>
        </button>
        <button
          className="flex-[1.4] h-[54px] flex flex-col items-center justify-center gap-0.5 rounded-xl font-bold transition-colors active:opacity-75"
          style={{ background: accent.bar, color: bg }}
        >
          <Check className="w-4 h-4" strokeWidth={3} />
          <span className="text-[10px] uppercase font-bold tracking-wider">Skid Done</span>
        </button>
      </footer>
    </div>
  );
}
