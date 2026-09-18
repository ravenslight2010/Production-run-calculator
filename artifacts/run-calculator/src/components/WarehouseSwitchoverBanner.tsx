import { Truck } from "lucide-react";
import { useHomeCtx } from "../contexts/HomeCtx";
import { useLiveRun } from "../contexts/LiveRunContext";
import { fmtClock, fmtComma, fmtNum } from "../utils";

type SwitchoverRunStatus = "pending" | "running" | "paused" | "ended";

export interface WarehouseSwitchoverBannerInputs {
  currentRun?: { endedAt?: number | null };
  runStatus: SwitchoverRunStatus;
  casesPerSkid: number;
  casesNeeded: number;
  ppm: number;
  pressCasesLeft: number;
  adjustedTimeSec: number;
  freezerTimeMin: number;
  nowMs: number;
  upcomingRunLabels: string[];
}

export interface WarehouseSwitchoverBannerModel {
  shortRun: boolean;
  packagingStage: boolean;
  skidsLeft: number;
  pressCasesLeft: number;
  pressStopAt: number | null;
  lineClearAt: number | null;
  upcomingRunLabels: string[];
}

/**
 * Build the warehouse handoff from the same live press calculation used by the
 * Run tab. Keep this eligibility gate in one place so the alert cannot drift
 * from the notification thresholds or show for incomplete/finished runs.
 */
export function getWarehouseSwitchoverBannerModel(
  input: WarehouseSwitchoverBannerInputs,
): WarehouseSwitchoverBannerModel | null {
  const cps = Number(input.casesPerSkid) || 0;
  const needed = Number(input.casesNeeded) || 0;
  if (
    input.currentRun?.endedAt
    || input.runStatus !== "running"
    || input.ppm <= 0
    || cps <= 0
    || needed <= 0
  ) {
    return null;
  }

  const pressLeft = input.pressCasesLeft;
  if (pressLeft <= 0 || pressLeft > 2 * cps) return null;

  const pressStopAt = input.adjustedTimeSec > 0
    ? input.nowMs + input.adjustedTimeSec * 1000
    : null;
  const lineClearAt = pressStopAt && input.freezerTimeMin > 0
    ? pressStopAt + input.freezerTimeMin * 60 * 1000
    : null;

  return {
    shortRun: needed < 2 * cps,
    packagingStage: pressLeft <= cps,
    skidsLeft: pressLeft / cps,
    pressCasesLeft: pressLeft,
    pressStopAt,
    lineClearAt,
    upcomingRunLabels: input.upcomingRunLabels.slice(0, needed < 2 * cps ? 3 : 1),
  };
}

export function WarehouseSwitchoverBanner() {
  const { currentRun, runStatus, upcomingRunLabels, v, ve } = useHomeCtx();
  const { calc, nowTime } = useLiveRun();
  const model = getWarehouseSwitchoverBannerModel({
    currentRun,
    runStatus,
    casesPerSkid: v.casesPerSkid,
    casesNeeded: v.casesNeeded,
    ppm: calc.ppm,
    pressCasesLeft: calc.pressCasesLeft,
    adjustedTimeSec: calc.adjustedTimeSec,
    freezerTimeMin: Number(ve.freezerTime) || 0,
    nowMs: nowTime.getTime(),
    upcomingRunLabels,
  });

  if (!model) return null;

  return (
    <div
      className="mb-4 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-3 flex items-start gap-2.5"
      data-testid="banner-warehouse-switchover"
    >
      <Truck className="w-4 h-4 shrink-0 mt-0.5 text-violet-400" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-violet-600 dark:text-violet-400">
          {model.shortRun
            ? "Warehouse: short run (under 2 skids) — stage frontline + packaging for the next 2+ runs now"
            : `Warehouse: ${fmtNum(model.skidsLeft, 1)} skid${model.skidsLeft === 1 ? "" : "s"} to switchover — stage ${model.packagingStage ? "packaging" : "frontline"} for the next run`}
        </p>
        {!model.shortRun && model.packagingStage && (
          <p
            className="text-xs font-semibold text-violet-400/90 mt-0.5"
            data-testid="text-switchover-packaging-stage"
          >
            Under 1 skid left at the press — frontline should already be staged; packaging goes now.
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {fmtComma(Math.ceil(model.pressCasesLeft))} cases left at the press (packing + Freeze tunnel counted done)
          {model.pressStopAt != null ? ` — press stops ~${fmtClock(model.pressStopAt)}` : ""}
          {model.lineClearAt != null ? `, line clear ~${fmtClock(model.lineClearAt)}` : ""}.
          {model.upcomingRunLabels.length > 0
            ? ` Next up: ${model.upcomingRunLabels.join(", ")}.`
            : " No upcoming runs scheduled yet."}
        </p>
      </div>
    </div>
  );
}