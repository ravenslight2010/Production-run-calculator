import { useId } from "react";
import { computeAutomaticFrontlineSupply, computeAutomaticSauceSupply } from "@workspace/live-calc";
import { fmtNum } from "../../utils";

export interface BatchMadeRowProps {
  label: string;
  totalBatches: number;
  made: number;
  onIncrement: () => void;
  onDecrement: () => void;
  isLive: boolean;
  testId?: string;
  sub?: string;
  disabled?: boolean;
  disabledReason?: string;
  pipeline?: "sauce" | "frontline";
}

/** Shared consumed-supply correction row used by Sauce and Frontline. */
export function BatchMadeRow({
  label,
  totalBatches,
  made,
  onIncrement,
  onDecrement,
  isLive,
  testId,
  sub,
  disabled,
  disabledReason,
  pipeline,
}: BatchMadeRowProps) {
  const generatedStatusId = useId();
  const supply = pipeline === "sauce"
    ? computeAutomaticSauceSupply({ total: totalBatches, consumed: made })
    : computeAutomaticFrontlineSupply({ total: totalBatches, consumed: made });
  const remaining = supply.stillToMake;
  const done = supply.remaining === 0 && made > 0;
  const unitLabel = pipeline === "sauce" ? "barrels" : "batches";
  const valueStr = done
    ? `${fmtNum(0, 2)} ${unitLabel} still to make · done ✓`
    : `${fmtNum(remaining, 2)} ${unitLabel} still to make`;
  const highlight = totalBatches > 0 && !done;
  const correctionStatusId = testId ? `${testId}-correction-status` : generatedStatusId;
  return (
    <div className={`flex items-start justify-between py-1.5 border-b border-border/40 last:border-0 ${highlight ? "text-primary" : done ? "text-emerald-400" : ""}`}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        {isLive && (totalBatches > 0 || made > 0) && (
          <div className="flex flex-col items-end gap-1 mt-0.5 shrink-0">
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={onDecrement} disabled={disabled} aria-describedby={disabledReason ? correctionStatusId : undefined} className="h-5 w-5 rounded border border-input bg-muted/40 hover:bg-muted text-xs font-bold text-foreground transition-colors flex items-center justify-center select-none touch-none" aria-label="Decrease consumed batches correction">−</button>
              <span className="text-xs font-mono w-5 text-center tabular-nums text-muted-foreground select-none">{made}</span>
              <button type="button" onClick={onIncrement} disabled={disabled} aria-describedby={disabledReason ? correctionStatusId : undefined} className="h-5 w-5 rounded border border-input bg-muted/40 hover:bg-muted text-xs font-bold text-foreground transition-colors flex items-center justify-center select-none touch-none" aria-label="Increase consumed batches correction">+</button>
            </div>
            {disabledReason && (
              <span id={correctionStatusId} role="status" className="max-w-48 text-right text-xs leading-tight text-amber-700 dark:text-amber-400" data-testid={correctionStatusId}>
                {disabledReason}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col items-end gap-0.5">
          <span className={`font-mono font-semibold text-sm tabular-nums ${done ? "text-emerald-400" : highlight ? "text-primary text-base" : "text-foreground"}`} data-testid={testId}>{valueStr}</span>
          {sub && <span className="text-xs text-muted-foreground font-normal leading-tight">{sub}</span>}
          <span className="text-xs text-muted-foreground font-normal leading-tight">Total {fmtNum(supply.total, 2)} · consumed {fmtNum(supply.consumed, 2)}</span>
          {isLive && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Correction controls</span>}
          <span className="text-xs text-muted-foreground font-normal leading-tight">On line {fmtNum(supply.onLine, 2)} · ready {fmtNum(supply.ready, 2)}{pipeline === "sauce" ? ` · being made ${fmtNum(supply.inProduction, 2)}` : ""}</span>
        </div>
      </div>
    </div>
  );
}

export default BatchMadeRow;