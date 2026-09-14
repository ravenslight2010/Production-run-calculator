import { useMemo } from "react";
import { useHomeTabCtx } from "../contexts/HomeTabCtx";
import { useLiveRun } from "../contexts/LiveRunContext";
import { fmtCountdownParts, fmtNum } from "../utils";
import { deriveFrontlineNeedRows } from "../frontlineRows";
import type { HomeTab } from "../hooks/useHomeNavigation";
import {
  Layers, Droplets, Flame, Boxes, Snowflake, Package, Warehouse,
  ArrowRight, Play, Pause, Square, Clock, AlertTriangle,
} from "lucide-react";

// ── Zone colors matching the physical line photo ──────────────────────────
const ZONE_COLORS = {
  dough:       { bg: "bg-stone-100 dark:bg-stone-800", border: "border-stone-300 dark:border-stone-600", icon: "text-stone-600 dark:text-stone-300", label: "bg-stone-200 dark:bg-stone-700" },
  sauce:       { bg: "bg-red-50 dark:bg-red-950/40", border: "border-red-300 dark:border-red-700", icon: "text-red-500 dark:text-red-400", label: "bg-red-100 dark:bg-red-900/50" },
  press:       { bg: "bg-gray-100 dark:bg-gray-800", border: "border-gray-300 dark:border-gray-600", icon: "text-gray-500 dark:text-gray-400", label: "bg-gray-200 dark:bg-gray-700" },
  frontline:   { bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-300 dark:border-amber-700", icon: "text-amber-500 dark:text-amber-400", label: "bg-amber-100 dark:bg-amber-900/50" },
  freezeTunnel:{ bg: "bg-sky-50 dark:bg-sky-950/40", border: "border-sky-300 dark:border-sky-700", icon: "text-sky-500 dark:text-sky-400", label: "bg-sky-100 dark:bg-sky-900/50" },
  packaging:   { bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-300 dark:border-emerald-700", icon: "text-emerald-500 dark:text-emerald-400", label: "bg-emerald-100 dark:bg-emerald-900/50" },
  warehouse:   { bg: "bg-stone-50 dark:bg-stone-900/40", border: "border-stone-300 dark:border-stone-600", icon: "text-stone-500 dark:text-stone-400", label: "bg-stone-100 dark:bg-stone-800" },
} as const;

type ZoneId = keyof typeof ZONE_COLORS;

interface ZoneStatus {
  id: ZoneId;
  label: string;
  icon: React.ReactNode;
  navTab: HomeTab;
  status: "active" | "idle" | "stopped" | "upstream";
  metrics: { label: string; value: string }[];
  sub?: string;
}
function statusBadge(status: ZoneStatus["status"]) {
  const map = {
    active:  { cls: "bg-emerald-500", label: "Running" },
    idle:    { cls: "bg-yellow-400", label: "Idle" },
    stopped: { cls: "bg-red-500", label: "Stopped" },
    upstream:{ cls: "bg-gray-400", label: "Waiting" },
  };
  const s = map[status];
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium">
      <span className={`w-2 h-2 rounded-full ${s.cls}`} />
      {s.label}
    </span>
  );
}

export default function LineMapDashboard() {
  const { v, ve, currentRun, dayState, runStatus, activePackagingRows, activeWarehouseRows } = useHomeTabCtx();
  const {
    calc, nowTime, elapsedBatchSec,
    liveFreezerMin, casesPct, casesFreezerPct, casesPctWithFreezer,
    currentBatchNum, secUntilNextBatch, totalBatchesNeeded,
    autoTrackProgress, autoTrackSuggestion,
  } = useLiveRun();

  const navigate = useHomeTabCtx().navigate ?? (() => {});

  const zones = useMemo<ZoneStatus[]>(() => {
    const isRunning = runStatus === "running";
    const isPaused = runStatus === "paused";
    const hasRun = !!currentRun;
    const running = isRunning || isPaused;

    // Dough station
    const doughStatus = (() => {
      if (!running) return "idle" as const;
      if (calc.doughDepletionSec > 0 && calc.doughDepletionSec < 600) return "active" as const;
      if (v.traysOnLine > 0 || v.batchesReady > 0) return "active" as const;
      return "idle" as const;
    })();
    const doughMetrics = [
      v.traysOnLine > 0 ? { label: "Trays on line", value: String(v.traysOnLine) } : null,
      v.batchesReady > 0 ? { label: "Batches ready", value: String(v.batchesReady) } : null,
      calc.doughDepletionSec > 0 ? { label: "Depletion", value: fmtCountdownParts(Math.floor(calc.doughDepletionSec / 60), Math.round(calc.doughDepletionSec % 60)) } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    // Sauce station
    const sauceStatus = (() => {
      if (!running) return "idle" as const;
      if (calc.sauceBatches > 0) return "active" as const;
      return "idle" as const;
    })();
    const sauceMetrics = [
      calc.sauceBatches > 0 ? { label: "Batches needed", value: String(calc.sauceBatches) } : null,
      v.sauceBarrelsMade > 0 ? { label: "Barrels made", value: String(v.sauceBarrelsMade) } : null,
      calc.sauceDepletionSec > 0 && calc.sauceDepletionSec < 86400 ? { label: "Depletion", value: fmtCountdownParts(Math.floor(calc.sauceDepletionSec / 60), Math.round(calc.sauceDepletionSec % 60)) } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    // Press/Oven (derived from calc — cases left / completed)
    const pressActive = running && calc.pressCasesLeft > 0;
    const pressStatus: "active" | "idle" | "stopped" = pressActive ? "active" : running ? "idle" : "idle";
    const pressMetrics = [
      calc.pressCasesLeft > 0 ? { label: "Cases left", value: String(calc.pressCasesLeft) } : null,
      calc.casesCompleted > 0 ? { label: "Cases done", value: `${fmtNum(calc.casesCompleted)} / ${fmtNum(v.casesNeeded)}` } : null,
      calc.ppm > 0 ? { label: "Line speed", value: `${fmtNum(calc.ppm)} ppm` } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    // Frontline (apps + pep)
    const frontlineStatus = (() => {
      if (!running) return "idle" as const;
      if (pressStatus === "active") return "active" as const;
      return "idle" as const;
    })();
    const frontlineRows = v.sauceOzPerPizza > 0 || v.app1OzPerPizza > 0 || v.app2OzPerPizza > 0
      ? deriveFrontlineNeedRows(v, {
          productionNeedsAvailable: true,
          sauceLbs: calc.sauceEffBarrel * (v.sauceBarrelsMade || 1),
          sauceBatches: calc.sauceBatches,
          app1Lbs: calc.app1Lbs, app1Batches: calc.app1Batches,
          app2Lbs: calc.app2Lbs, app2Batches: calc.app2Batches,
          app3Lbs: calc.app3Lbs, app3Batches: calc.app3Batches,
          app4Lbs: calc.app4Lbs, app4Batches: calc.app4Batches,
          pep1Lbs: calc.pep1Lbs, pep1Batches: calc.pep1Batches,
          pep2Lbs: calc.pep2Lbs, pep2Batches: calc.pep2Batches,
          pep1LbsB: calc.pep1LbsB, pep1BatchesB: calc.pep1BatchesB,
          pep2LbsB: calc.pep2LbsB, pep2BatchesB: calc.pep2BatchesB,
        })
      : [];
    const frontlineMetrics = frontlineRows.slice(0, 3).map(r => ({
      label: r.label,
      value: `${fmtNum(r.amount)} ${r.unit}`,
    }));

    // Freeze Tunnel (derived from calc — cases in freezer)
    const tunnelActive = running && calc.casesInFreezer > 0;
    const tunnelStatus: "active" | "idle" | "stopped" = tunnelActive ? "active" : running ? "idle" : "idle";
    const tunnelMetrics = [
      calc.casesInFreezer > 0 ? { label: "Cases in tunnel", value: String(calc.casesInFreezer) } : null,
      casesFreezerPct > 0 ? { label: "Fill level", value: `${Math.round(casesFreezerPct * 100)}%` } : null,
      ve.freezerTime > 0 ? { label: "Transit time", value: `${fmtNum(ve.freezerTime)} min` } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    // Packaging (derived from calc — cases completed vs needed)
    const packActive = running && calc.casesCompleted > 0 && calc.casesCompleted < v.casesNeeded;
    const packStatus: "active" | "idle" | "stopped" = packActive ? "active" : running ? "idle" : "idle";
    const packMetrics = [
      autoTrackSuggestion ? { label: "Skids", value: `${autoTrackSuggestion.skids} full` } : null,
      autoTrackSuggestion ? { label: "Current skid", value: `${autoTrackSuggestion.casesOnSkid} / ${v.casesPerSkid}` } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    // Warehouse
    const whMetrics = [
      { label: "Total cases", value: fmtNum(calc.casesCompleted) },
      { label: "Target", value: fmtNum(v.casesNeeded) },
    ];

    return [
      { id: "dough" as ZoneId, label: "Dough", icon: <Layers className="w-5 h-5" />, navTab: "dough", status: doughStatus, metrics: doughMetrics, sub: "Mix · Form · Stage" },
      { id: "sauce" as ZoneId, label: "Sauce", icon: <Droplets className="w-5 h-5" />, navTab: "sauce", status: sauceStatus, metrics: sauceMetrics, sub: "Mix · Barrel" },
      { id: "press" as ZoneId, label: "Press / Oven", icon: <Flame className="w-5 h-5" />, navTab: "run", status: pressStatus, metrics: pressMetrics, sub: `Pre-tunnel ${fmtNum(v.preTunnelMin || 2.5)} min` },
      { id: "frontline" as ZoneId, label: "Frontline", icon: <Boxes className="w-5 h-5" />, navTab: "frontline", status: frontlineStatus, metrics: frontlineMetrics, sub: "App 1-4 · Pep 1-2" },
      { id: "freezeTunnel" as ZoneId, label: "Freeze Tunnel", icon: <Snowflake className="w-5 h-5" />, navTab: "run", status: tunnelStatus, metrics: tunnelMetrics, sub: `Total ${fmtNum(ve.freezerTime)} min` },
      { id: "packaging" as ZoneId, label: "Packaging", icon: <Package className="w-5 h-5" />, navTab: "packaging", status: packStatus, metrics: packMetrics, sub: `Post-tunnel ${fmtNum(v.postTunnelMin || 2.5)} min` },
      { id: "warehouse" as ZoneId, label: "Warehouse", icon: <Warehouse className="w-5 h-5" />, navTab: "warehouse", status: "idle", metrics: whMetrics, sub: "Cooler · Freezer" },
    ];
  }, [calc, currentRun, dayState, runStatus, v, ve, autoTrackSuggestion, casesFreezerPct]);

  // Overall line status
  const overallStatus = (() => {
    if (runStatus === "running") return { label: "LINE RUNNING", cls: "bg-emerald-600 text-white" };
    if (runStatus === "paused") return { label: "LINE PAUSED", cls: "bg-yellow-500 text-black" };
    return { label: "NO ACTIVE RUN", cls: "bg-stone-400 text-white" };
  })();

  return (
    <div className="w-full space-y-4 p-2 sm:p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Production Line Map</h2>
        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${overallStatus.cls}`}>
          {overallStatus.label}
        </span>
      </div>

      {/* Line progress bar */}
      {currentRun && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{fmtNum(calc.casesCompleted)} cases completed</span>
            <span>{Math.round(casesPct * 100)}% of {fmtNum(v.casesNeeded)}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-1000"
              style={{ width: `${Math.min(100, casesPct * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Flow diagram: U-shaped line */}
      <div className="relative">
        {/* Top row: Dough → Sauce → Press/Oven → Frontline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-0">
          {zones.slice(0, 4).map((zone, i) => (
            <ZoneCard key={zone.id} zone={zone} onClick={() => navigate(zone.navTab)} />
          ))}
        </div>

        {/* Vertical connector (down-right arrow) */}
        <div className="flex justify-end pr-4 h-6 relative">
          <div className="flex flex-col items-center text-muted-foreground">
            <ArrowRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* Bottom row: Warehouse ← Packaging ← Freeze Tunnel */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {zones.slice(4).map((zone) => (
            <ZoneCard key={zone.id} zone={zone} onClick={() => navigate(zone.navTab)} />
          ))}
        </div>
      </div>

      {/* Line speed and timing summary */}
      {currentRun && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border bg-card p-2">
            <div className="text-xs text-muted-foreground">Line Speed</div>
            <div className="text-sm font-bold tabular-nums">{calc.ppm > 0 ? `${fmtNum(calc.ppm)} ppm` : "—"}</div>
          </div>
          <div className="rounded-lg border bg-card p-2">
            <div className="text-xs text-muted-foreground">Freeze Transit</div>
            <div className="text-sm font-bold tabular-nums">{ve.freezerTime > 0 ? `${fmtNum(ve.freezerTime)} min` : "—"}</div>
          </div>
          <div className="rounded-lg border bg-card p-2">
            <div className="text-xs text-muted-foreground">Total Time</div>
            <div className="text-sm font-bold tabular-nums">{calc.totalTimeSec > 0 ? fmtCountdownParts(Math.floor(calc.totalTimeSec / 60), Math.round(calc.totalTimeSec % 60)) : "—"}</div>
          </div>
        </div>
      )}

      {!currentRun && (
        <div className="text-center py-8 text-muted-foreground">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Start a run to see the line map</p>
        </div>
      )}
    </div>
  );
}

// ── Zone card sub-component ───────────────────────────────────────────────
function ZoneCard({ zone, onClick }: { zone: ZoneStatus; onClick: () => void }) {
  const colors = ZONE_COLORS[zone.id];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        rounded-xl border-2 ${colors.border} ${colors.bg}
        p-3 text-left transition-all hover:scale-[1.02] hover:shadow-md
        active:scale-[0.98] cursor-pointer
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`flex items-center gap-1.5 ${colors.icon}`}>
          {zone.icon}
          <span className="text-sm font-bold truncate">{zone.label}</span>
        </div>
        {statusBadge(zone.status)}
      </div>
      {zone.sub && (
        <p className="text-[10px] text-muted-foreground mb-1.5 truncate">{zone.sub}</p>
      )}
      {zone.metrics.length > 0 && (
        <div className="space-y-0.5">
          {zone.metrics.map((m) => (
            <div key={m.label} className="flex justify-between text-xs">
              <span className="text-muted-foreground truncate">{m.label}</span>
              <span className="font-medium tabular-nums ml-1">{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
